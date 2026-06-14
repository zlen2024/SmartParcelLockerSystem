from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import os
import random
import json
import uvicorn
from fastapi.middleware.cors import CORSMiddleware

from database import engine, Base, get_db
import models, schemas

# Create DB tables
Base.metadata.create_all(bind=engine)

# Seed default admin accounts
def seed_admins():
    from database import SessionLocal
    db = SessionLocal()
    try:
        # Check if master exists
        master_user = db.query(models.User).filter(models.User.email == "admin_master@gmail.com").first()
        if not master_user:
            admin_master = models.User(name="Administrator", email="admin_master@gmail.com", password="master_password")
            db.add(admin_master)
            db.commit()
            db.refresh(admin_master)
            db.add(models.Admin(userID=admin_master.userID))
            db.commit()
            print("[SEED] Created Administrator (admin_master@gmail.com / master_password)")
            
        # Check and update Admin 1 -> Staff 1
        staff1 = db.query(models.User).filter(models.User.email == "admin1@gmail.com").first()
        if staff1:
            staff1.name = "Staff 1"
            staff1.email = "staff1@gmail.com"
            staff1.password = "staff1"
            db.commit()
        elif db.query(models.User).filter(models.User.email == "staff1@gmail.com").count() == 0:
            user1 = models.User(name="Staff 1", email="staff1@gmail.com", password="staff1")
            db.add(user1)
            db.commit()
            db.refresh(user1)
            db.add(models.Admin(userID=user1.userID))
            db.commit()
            
        # Check and update Admin 2 -> Staff 2
        staff2 = db.query(models.User).filter(models.User.email == "admin2@gmail.com").first()
        if staff2:
            staff2.name = "Staff 2"
            staff2.email = "staff2@gmail.com"
            staff2.password = "staff2"
            db.commit()
        elif db.query(models.User).filter(models.User.email == "staff2@gmail.com").count() == 0:
            user2 = models.User(name="Staff 2", email="staff2@gmail.com", password="staff2")
            db.add(user2)
            db.commit()
            db.refresh(user2)
            db.add(models.Admin(userID=user2.userID))
            db.commit()
    finally:
        db.close()

seed_admins()

app = FastAPI(title="Pick N Go - Smart Locker API (V2)")

# Add CORS support
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, device_id: str):
        await websocket.accept()
        self.active_connections[device_id] = websocket

    def disconnect(self, device_id: str):
        if device_id in self.active_connections:
            del self.active_connections[device_id]

    async def send_command(self, device_id: str, command: dict):
        if device_id in self.active_connections:
            await self.active_connections[device_id].send_json(command)
            return True
        return False

manager = ConnectionManager()

@app.post("/register")
def register_customer(data: schemas.CustomerRegister, db: Session = Depends(get_db)):
    # Check if user already exists
    existing_user = db.query(models.User).filter(models.User.email == data.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create User
    new_user = models.User(
        name=data.name,
        email=data.email,
        password=data.password # In production, hash this!
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Create Customer
    new_customer = models.Customer(
        userID=new_user.userID,
        studentID=data.studentID,
        phoneNo=data.phoneNo
    )
    db.add(new_customer)
    db.commit()
    
    return {"message": "Registration successful", "userID": new_user.userID}

@app.post("/login")
def login_user(data: schemas.UserLogin, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(
        models.User.email == data.email,
        models.User.password == data.password
    ).first()
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Check if user is a customer
    customer = db.query(models.Customer).filter(models.Customer.userID == user.userID).first()
    return {"message": "Login successful", "name": user.name, "studentID": customer.studentID if customer else None}

@app.post("/admin/login")
def admin_login(data: schemas.UserLogin, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(
        models.User.email == data.email,
        models.User.password == data.password
    ).first()
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Verify this user is an admin
    admin = db.query(models.Admin).filter(models.Admin.userID == user.userID).first()
    if not admin:
        raise HTTPException(status_code=403, detail="This account is not an admin")
    
    return {"message": "Login successful", "adminID": admin.adminID, "name": user.name}

def generate_random_pin():
    return str(random.randint(1000, 9999))

@app.post("/requests/", response_model=schemas.RequestResponse)
def create_request(req_data: schemas.RequestCreate, db: Session = Depends(get_db)):
    req_datetime = datetime.utcnow()
    if req_data.reqDate:
        try:
            req_datetime = datetime.strptime(req_data.reqDate, "%Y-%m-%d")
        except ValueError:
            pass

    # Store as a status-only request; parcelID FK is left null.
    # The user-provided parcel reference is kept in requestedParcelRef.
    db_request = models.Request(
        studentID=req_data.studentID,
        parcelID=None,                 # No real parcel row yet
        requestedParcelRef=str(req_data.parcelID) if req_data.parcelID else None,
        requestStatus="Available",
        approvedByAdmin=False,
        timestamp=req_datetime
    )
    db.add(db_request)
    db.commit()
    db.refresh(db_request)
    return db_request

def check_and_auto_reject_if_full(db: Session):
    # Check how many lockers are currently occupied
    occupied_count = 0
    for lid in [1, 2, 3]:
        locker = db.query(models.Locker).filter(models.Locker.lockerID == lid).first()
        if locker and locker.lockerStatus not in ["Available", "Vacant"] and locker.parcelID is not None:
            occupied_count += 1
            
    if occupied_count >= 3:
        # Find all other pending/available requests
        pending_requests = db.query(models.Request).filter(
            models.Request.requestStatus.in_(["Available", "Pending"])
        ).all()
        
        for req in pending_requests:
            req.requestStatus = "Rejected"
            student_user = db.query(models.User).join(models.Customer).filter(
                models.Customer.studentID == req.studentID
            ).first()
            to_email = student_user.email if student_user else f"{req.studentID}@student.edu"
            body = (
                f"Hello,\n\nYour locker request has been automatically declined because all lockers are currently full.\n"
                f"Please try again later when space becomes available.\n\nSmart Locker Admin"
            )
            send_email_notification(to_email, "Locker Request Auto-Declined (Lockers Full)", body)
        db.commit()

@app.post("/parcels/", response_model=schemas.ParcelResponse)
def assign_parcel(parcel: schemas.ParcelCreate, db: Session = Depends(get_db)):
    # 1. Ensure Locker exists and is not occupied
    locker = db.query(models.Locker).filter(models.Locker.lockerID == parcel.lockerID).first()
    if locker and locker.lockerStatus not in ["Available", "Vacant"] and locker.parcelID is not None:
        raise HTTPException(status_code=400, detail=f"Locker {parcel.lockerID} is already occupied")

    if not locker:
        locker = models.Locker(lockerID=parcel.lockerID, lockerStatus="Occupied")
        db.add(locker)
    else:
        locker.lockerStatus = "Occupied"
    
    # 2. Create Parcel
    db_parcel = models.Parcel(
        lockerID=parcel.lockerID,
        parcelPIN=parcel.parcelPIN,
        hasPenalty=parcel.hasPenalty
    )
    db.add(db_parcel)
    db.commit()
    db.refresh(db_parcel)
    
    # 3. Update Locker with parcelID
    locker.parcelID = db_parcel.parcelID
    
    # 4. Create a Request record (as per ERD)
    # Note: We assume studentID is provided via some context or mock for now
    # In a real app, we'd look up the customer
    db_request = models.Request(
        studentID=parcel.studentID,
        parcelID=db_parcel.parcelID,
        requestStatus="Available",
        approvedByAdmin=False
    )
    db.add(db_request)
    db.commit()
    
    print(f"[SMS MOCK] Sent PIN {parcel.parcelPIN} for Locker {parcel.lockerID}")
    
    # Check if all 3 lockers are full and auto-reject others
    check_and_auto_reject_if_full(db)
    
    return db_parcel

@app.post("/verify/")
async def verify_pin(verify: schemas.PinVerify, db: Session = Depends(get_db)):
    # Find parcel by PIN
    parcel = db.query(models.Parcel).filter(
        models.Parcel.parcelPIN == verify.generated_pin
    ).first()
    
    if not parcel:
        raise HTTPException(status_code=400, detail="Invalid or expired PIN")
        
    # Check expiry (72h limit)
    if datetime.utcnow() - parcel.storageTime > timedelta(hours=72):
        if not parcel.hasPenalty:
            parcel.hasPenalty = True
            db.commit()
        raise HTTPException(status_code=400, detail="Parcel expired (72h limit). Please see Admin.")
        
    # Send command to ESP32
    success = await manager.send_command("ESP32_MAIN", {"action": "OPEN", "lockerID": parcel.lockerID})
    if not success:
        # For testing purposes, we might want to proceed even if hardware is offline
        # But in production, we'd fail here.
        pass
        
    # Update status
    locker = db.query(models.Locker).filter(models.Locker.lockerID == parcel.lockerID).first()
    if locker:
        locker.lockerStatus = "Available"
        locker.parcelID = None
    
    # Update request status
    request = db.query(models.Request).filter(models.Request.parcelID == parcel.parcelID).first()
    if request:
        request.requestStatus = "Collected"
        
    db.commit()
    
    return {"message": f"Success. Locker {parcel.lockerID} opened."}

@app.websocket("/ws/esp32/{device_id}")
async def websocket_endpoint(websocket: WebSocket, device_id: str, db: Session = Depends(get_db)):
    await manager.connect(websocket, device_id)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
                if payload.get("action") == "ALARM_TRIGGERED":
                    lockerID = payload.get("lockerID")
                    if lockerID:
                        locker = db.query(models.Locker).filter(models.Locker.lockerID == lockerID).first()
                        if locker:
                            locker.lockerStatus = "Alarm"
                            db.commit()
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(device_id)

# Admin Endpoints
@app.get("/admin/requests")
def list_requests(db: Session = Depends(get_db)):
    return db.query(models.Request).all()

@app.get("/admin/parcels")
def list_parcels(db: Session = Depends(get_db)):
    # Join Parcel, Request, and Customer to get studentID, phoneNo, and requestStatus
    results = db.query(models.Parcel, models.Request.studentID, models.Customer.phoneNo, models.Request.requestID, models.Request.requestStatus)\
                .outerjoin(models.Request, models.Parcel.parcelID == models.Request.parcelID)\
                .outerjoin(models.Customer, models.Request.studentID == models.Customer.studentID)\
                .all()
    
    response = []
    for parcel, student_id, phone_no, request_id, request_status in results:
        # Check if overdue and auto-apply penalty
        is_overdue = False
        if parcel.storageTime:
            # Check if request status is still active (Stored or Available or Pending)
            if request_status in ["Stored", "Available", "Pending", None]:
                is_overdue = (datetime.utcnow() - parcel.storageTime) > timedelta(hours=72)
                if is_overdue and not parcel.hasPenalty:
                    parcel.hasPenalty = True
                    db.commit()

        p_dict = {
            "parcelID": parcel.parcelID,
            "lockerID": parcel.lockerID,
            "parcelPIN": parcel.parcelPIN,
            "hasPenalty": parcel.hasPenalty,
            "storageTime": parcel.storageTime.isoformat() if parcel.storageTime else None,
            "studentID": student_id or "Unknown",
            "phoneNo": phone_no or "Unknown",
            "requestID": request_id or "Unknown",
            "status": request_status or "Available"
        }
        response.append(p_dict)
    return response

@app.get("/admin/lockers")
def list_lockers(db: Session = Depends(get_db)):
    return db.query(models.Locker).all()

def send_email_notification(to_email: str, subject: str, body: str):
    print("\n" + "="*60)
    print(f"📧 AUTOMATED EMAIL DISPATCHED")
    print(f"TO:      {to_email}")
    print(f"SUBJECT: {subject}")
    print("-" * 60)
    print(body)
    print("="*60 + "\n")

@app.put("/admin/requests/{requestID}/approve")
def approve_request(requestID: int, status_update: dict, db: Session = Depends(get_db)):
    """Primary approval endpoint — looks up by requestID (the true PK)."""
    request = db.query(models.Request).filter(models.Request.requestID == requestID).first()
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")

    new_status = status_update.get("status")

    # Fetch student email
    student_user = db.query(models.User).join(models.Customer).filter(
        models.Customer.studentID == request.studentID
    ).first()
    to_email = student_user.email if student_user else f"{request.studentID}@student.edu"

    if new_status == "Stored":
        # Only assign a locker if one hasn't been assigned yet
        if not request.parcelID:
            available_lockers = []
            for lid in [1, 2, 3]:
                locker = db.query(models.Locker).filter(models.Locker.lockerID == lid).first()
                if not locker:
                    locker = models.Locker(lockerID=lid, lockerStatus="Available")
                    db.add(locker)
                    db.commit()
                    db.refresh(locker)
                if locker.lockerStatus in ["Available", "Vacant"]:
                    available_lockers.append(locker)

            if not available_lockers:
                raise HTTPException(status_code=400, detail="All lockers are currently full")

            assigned_locker = random.choice(available_lockers)

            new_parcel = models.Parcel(
                lockerID=assigned_locker.lockerID,
                parcelPIN=generate_random_pin(),
                hasPenalty=False
            )
            db.add(new_parcel)
            db.commit()
            db.refresh(new_parcel)

            assigned_locker.lockerStatus = "Occupied"
            assigned_locker.parcelID = new_parcel.parcelID
            request.parcelID = new_parcel.parcelID
            request.approvedByAdmin = True

            body = (
                f"Hello,\n\nGreat news! Your parcel has been approved and stored.\n"
                f"Locker Number: {assigned_locker.lockerID}\n"
                f"Parcel ID: {new_parcel.parcelID}\n"
                f"Please collect within 72 hours.\n\nSmart Locker Admin"
            )
            send_email_notification(to_email, "Your Parcel is Ready for Collection!", body)

    elif new_status == "Rejected":
        body = (
            f"Hello,\n\nYour locker request has been declined.\n"
            f"If this is an error, please contact staff or use the support form.\n\nSmart Locker Admin"
        )
        send_email_notification(to_email, "Locker Request Declined", body)

    request.requestStatus = new_status
    db.commit()
    
    # Check if all 3 lockers are full and auto-reject others
    if new_status == "Stored":
        check_and_auto_reject_if_full(db)
        
    return {"message": f"Request {requestID} updated to {new_status}"}


@app.put("/admin/parcels/{parcelID}/status")
def update_parcel_status(parcelID: int, status_update: dict, db: Session = Depends(get_db)):
    """Used for Manage Parcel actions (Clear, Collected, etc.) on existing parcels."""
    parcel = db.query(models.Parcel).filter(models.Parcel.parcelID == parcelID).first()
    if not parcel:
        raise HTTPException(status_code=404, detail="Parcel not found")

    new_status = status_update.get("status")
    request = db.query(models.Request).filter(models.Request.parcelID == parcelID).first()
    if request:
        request.requestStatus = new_status

    if new_status in ["Collected", "Removed", "Clear", "Rejected"]:
        locker = db.query(models.Locker).filter(models.Locker.lockerID == parcel.lockerID).first()
        if locker:
            locker.lockerStatus = "Available"
            locker.parcelID = None

    db.commit()
    return {"message": f"Parcel {parcelID} status updated to {new_status}"}

@app.post("/admin/override/{lockerID}")
async def admin_override(lockerID: int, db: Session = Depends(get_db)):
    locker = db.query(models.Locker).filter(models.Locker.lockerID == lockerID).first()
    if not locker:
        raise HTTPException(status_code=404, detail="Locker not found")
    
    await manager.send_command("ESP32_MAIN", {"action": "OPEN", "lockerID": lockerID, "mode": "EMERGENCY"})
    return {"status": "Override Successful", "locker_id": lockerID}

@app.get("/admin/statistics")
def get_statistics(db: Session = Depends(get_db)):
    from sqlalchemy import func
    
    # 1. Most frequently used locker
    locker_counts = db.query(
        models.Parcel.lockerID, 
        func.count(models.Parcel.parcelID).label('usage_count')
    ).group_by(models.Parcel.lockerID).all()
    
    locker_stats = [{"lockerID": lc[0], "count": lc[1]} for lc in locker_counts]
    
    # 2. Busiest Peak Days of the Week
    # We can fetch all timestamps and calculate in python to avoid sqlite specific datetime functions
    requests = db.query(models.Request.timestamp).all()
    days_count = {
        "Monday": 0, "Tuesday": 0, "Wednesday": 0, 
        "Thursday": 0, "Friday": 0, "Saturday": 0, "Sunday": 0
    }
    
    days_map = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    for r in requests:
        if r.timestamp:
            day_name = days_map[r.timestamp.weekday()]
            days_count[day_name] += 1
            
    # Format for chart.js
    peak_days = [{"day": k, "count": v} for k, v in days_count.items()]
    
    return {
        "locker_usage": locker_stats,
        "peak_days": peak_days
    }

@app.get("/health")
def health_check():
    return {"status": "ok"}

# Mount frontend
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

if __name__ == "__main__":
    reload_enabled = os.getenv("SMART_LOCKER_RELOAD", "0").lower() in {"1", "true", "yes", "on"}
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=reload_enabled)
