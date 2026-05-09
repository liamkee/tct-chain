import React from 'react'
import { useDashboardStore } from '../hooks/useDashboardStore'
import { toast } from 'react-hot-toast'

export const DashboardControls: React.FC = () => {
  const { filters, toggleFilter, chain, setTarget, viewMode, setViewMode, masterSwitch } = useDashboardStore();

  const handleToggle = async () => {
    const action = masterSwitch === 'ON' ? 'stop' : 'start';
    const toastId = toast.loading(`${action === 'start' ? 'Starting' : 'Stopping'} Tactical Engine...`);

    try {
      const res = await fetch(`/api/dashboard/${action}`);
      if (res.ok) {
        toast.success(`Engine ${action === 'start' ? 'Active' : 'Standby'}`, { id: toastId });
        // Use a slight delay before reload to let the user see the success message
        // No reload needed! The WebSocket broadcast will update the UI instantly
      } else {
        toast.error('Tactical Uplink Failed', { id: toastId });
      }
    } catch (e) {
      toast.error('Network Error', { id: toastId });
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-center p-3 md:p-4 bg-zinc-950/30">
      {/* DashboardControls now only serves as a container or can be removed if Switch is moved */}
    </div>
  )
}
