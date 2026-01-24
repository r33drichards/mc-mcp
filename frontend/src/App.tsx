import { MinecraftViewer } from './MinecraftViewer'
import { AgentChat } from './AgentChat'

function App() {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* 3D Minecraft Viewer */}
      <MinecraftViewer />

      {/* Agent Chat Overlay */}
      <div style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: '400px',
        height: '100%',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
      }}>
        <AgentChat />
      </div>
    </div>
  )
}

export default App
