from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

# User Schemas
class UserBase(BaseModel):
    name: str
    email: str

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    userID: int
    class Config:
        from_attributes = True

# Customer Schemas
class CustomerBase(BaseModel):
    studentID: str
    phoneNo: str

class CustomerCreate(CustomerBase):
    userID: int

class CustomerResponse(CustomerBase):
    userID: int
    class Config:
        from_attributes = True

# Admin Schemas
class AdminResponse(BaseModel):
    adminID: int
    userID: int
    class Config:
        from_attributes = True

# Parcel Schemas
class ParcelBase(BaseModel):
    lockerID: int
    parcelPIN: str
    hasPenalty: bool = False

class ParcelCreate(ParcelBase):
    studentID: str

class ParcelResponse(ParcelBase):
    parcelID: int
    storageTime: datetime
    class Config:
        from_attributes = True

# Request Schemas
class RequestBase(BaseModel):
    studentID: str
    parcelID: Optional[int] = None
    requestStatus: str = "Pending"

class RequestCreate(RequestBase):
    pass

class RequestResponse(RequestBase):
    requestID: int
    adminID: Optional[int] = None
    timestamp: datetime
    approvedByAdmin: bool
    class Config:
        from_attributes = True

# Locker Schemas
class LockerBase(BaseModel):
    lockerStatus: str = "Available"

class LockerResponse(LockerBase):
    lockerID: int
    parcelID: Optional[int] = None
    class Config:
        from_attributes = True

# PIN Verification
class PinVerify(BaseModel):
    generated_pin: str

# Auth Schemas
class CustomerRegister(BaseModel):
    name: str
    studentID: str
    email: str
    phoneNo: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str
