from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
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
        # Only seed if no admins exist
        if db.query(models.Admin).count() == 0:
            # Admin 1
            admin_user1 = models.User(name="Admin 1", email="admin1@gmail.com", password="admin1")
            db.add(admin_user1)
            db.commit()
            db.refresh(admin_user1)
            db.add(models.Admin(userID=admin_user1.userID))
            
            # Admin 2
            admin_user2 = models.User(name="Admin 2", email="admin2@gmail.com", password="admin2")
            db.add(admin_user2)
            db.commit()
            db.refresh(admin_user2)
            db.add(models.Admin(userID=admin_user2.userID))
            
            db.commit()
            print("[SEED] Created Admin 1 (admin1@gmail.com / admin1) and Admin 2 (admin2@gmail.com / admin2)")
    finally:
        db.close()

seed_admins()

app = FastAPI(title="Pick N Go - Smart Locker API (V2)")

# Add CORS support
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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

@app.post("/parcels/", response_model=schemas.ParcelResponse)
def assign_parcel(parcel: schemas.ParcelCreate, db: Session = Depends(get_db)):
    # 1. Ensure Locker exists
    locker = db.query(models.Locker).filter(models.Locker.lockerID == parcel.lockerID).first()
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
        requestStatus="Stored",
        approvedByAdmin=True
    )
    db.add(db_request)
    db.commit()
    
    print(f"[SMS MOCK] Sent PIN {parcel.parcelPIN} for Locker {parcel.lockerID}")
    
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
    return db.query(models.Parcel).all()

@app.get("/admin/lockers")
def list_lockers(db: Session = Depends(get_db)):
    return db.query(models.Locker).all()

@app.put("/admin/parcels/{parcelID}/status")
def update_parcel_status(parcelID: int, status_update: dict, db: Session = Depends(get_db)):
    request = db.query(models.Request).filter(models.Request.parcelID == parcelID).first()
    if not request:
        raise HTTPException(status_code=404, detail="Request/Parcel not found")
    request.requestStatus = status_update.get("status")
    db.commit()
    return {"message": "Status updated"}

@app.post("/admin/override/{lockerID}")
async def admin_override(lockerID: int, db: Session = Depends(get_db)):
    locker = db.query(models.Locker).filter(models.Locker.lockerID == lockerID).first()
    if not locker:
        raise HTTPException(status_code=404, detail="Locker not found")
    
    await manager.send_command("ESP32_MAIN", {"action": "OPEN", "lockerID": lockerID, "mode": "EMERGENCY"})
    return {"status": "Override Successful", "locker_id": lockerID}

# Mount frontend
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
