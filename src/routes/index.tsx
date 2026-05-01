import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  return (
    <div className="p-2">
      <h3 className="text-lg font-medium text-zinc-100">Welcome to TCT Control Plane</h3>
      <p className="mt-2 text-zinc-400">Phase 0 Infrastructure Initialization Complete.</p>
    </div>
  )
}
