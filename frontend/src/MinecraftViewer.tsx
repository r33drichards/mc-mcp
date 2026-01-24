export function MinecraftViewer() {
  // Use prismarine-viewer's built-in web client via iframe
  // This includes all the chunk rendering, block textures, and world view
  const viewerUrl = import.meta.env.VITE_VIEWER_URL || 'http://localhost:3000'

  return (
    <iframe
      src={viewerUrl}
      style={{
        width: 'calc(100% - 400px)',
        height: '100%',
        position: 'absolute',
        left: 0,
        top: 0,
        border: 'none',
      }}
      title="Minecraft Viewer"
    />
  )
}
