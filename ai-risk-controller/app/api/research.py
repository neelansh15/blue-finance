"""Research/demo endpoints kept separate from lending recommendations."""
from fastapi import APIRouter
from app.joint_stress import JointStressRequest, analyse_joint_stress

router = APIRouter(prefix="/research", tags=["Research demos"])

@router.post("/joint-stress", summary="Estimate simultaneous stock losses and shared USDT supplier exposure")
def joint_stress(body: JointStressRequest):
    return analyse_joint_stress(body)
