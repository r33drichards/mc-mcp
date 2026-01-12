const mineflayer = require('mineflayer')
const { Viewer, WorldView } = require('prismarine-viewer').viewer
const { createCanvas } = require('node-canvas-webgl')
const THREE = require('three')
const { EventEmitter } = require('events')
const fs = require('fs')
const path = require('path')

// Camera class for capturing screenshots
class Camera extends EventEmitter {
  constructor (bot, options = {}) {
    super()
    this.bot = bot
    this.viewDistance = options.viewDistance || 4
    this.width = options.width || 512
    this.height = options.height || 512
    this.output = options.output || './screenshots'

    // Create screenshots directory if it doesn't exist
    if (!fs.existsSync(this.output)) {
      fs.mkdirSync(this.output, { recursive: true })
    }

    // Initialize rendering components
    this.canvas = createCanvas(this.width, this.height)
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas })
    this.viewer = new Viewer(this.renderer)

    // Initialize world view
    if (!this.viewer.setVersion) {
      console.error('prismarine-viewer version may not be compatible')
    }
  }

  async init () {
    // Set the Minecraft version
    this.viewer.setVersion(this.bot.version)

    // Calculate camera position (above the bot)
    const pos = this.bot.entity.position
    const cameraPos = pos.offset(0, 10, 0)

    // Create world view centered on bot
    this.worldView = new WorldView(
      this.bot.world,
      this.viewDistance,
      cameraPos
    )

    // Initialize world view
    this.viewer.listen(this.worldView)
    this.worldView.init(cameraPos)

    // Wait for chunks to load
    await this.worldView.updatePosition(cameraPos)
  }

  async takePicture (filename, options = {}) {
    const yaw = options.yaw || this.bot.entity.yaw
    const pitch = options.pitch || -(Math.PI / 4) // Look down by default
    const pos = options.position || this.bot.entity.position.offset(0, 10, 0)

    // Update world view position
    await this.worldView.updatePosition(pos)

    // Wait for world data to load
    const waitTime = options.waitTime || 5000
    await new Promise(resolve => setTimeout(resolve, waitTime))

    // Set camera position and orientation
    this.viewer.camera.position.set(pos.x, pos.y, pos.z)

    // Calculate look direction from yaw and pitch
    const lookX = -Math.sin(yaw) * Math.cos(pitch)
    const lookY = Math.sin(pitch)
    const lookZ = -Math.cos(yaw) * Math.cos(pitch)
    this.viewer.camera.lookAt(
      pos.x + lookX,
      pos.y + lookY,
      pos.z + lookZ
    )

    // Render the scene
    this.viewer.update()
    this.renderer.render(this.viewer.scene, this.viewer.camera)

    // Save as JPEG
    const filepath = path.join(this.output, filename)
    const stream = this.canvas.createJPEGStream({
      quality: 1.0
    })
    const writeStream = fs.createWriteStream(filepath)

    return new Promise((resolve, reject) => {
      stream.pipe(writeStream)
      writeStream.on('finish', () => {
        console.log(`Screenshot saved to ${filepath}`)
        resolve(filepath)
      })
      writeStream.on('error', reject)
    })
  }

  cleanup () {
    if (this.renderer) {
      this.renderer.dispose()
    }
  }
}

// Main function - runs when executed directly
async function main () {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.log('Usage: node screenshot.js <host> <port> [<username>] [<password>]')
    console.log('Environment variables: HOST, PORT, USERNAME, PASSWORD')
    process.exit(1)
  }

  const host = args[0] || process.env.HOST
  const port = parseInt(args[1] || process.env.PORT)
  const username = args[2] || process.env.USERNAME || 'screenshot_bot'
  const password = args[3] || process.env.PASSWORD

  console.log(`Connecting to ${host}:${port} as ${username}...`)

  const bot = mineflayer.createBot({
    host,
    port,
    username,
    password,
    auth: password ? 'microsoft' : 'offline'
  })

  bot.once('spawn', async () => {
    console.log('Bot spawned, initializing camera...')

    const camera = new Camera(bot, {
      viewDistance: 4,
      width: 512,
      height: 512,
      output: './screenshots'
    })

    try {
      await camera.init()
      console.log('Camera initialized, taking screenshot...')

      const filename = `screenshot_${Date.now()}.jpg`
      await camera.takePicture(filename)

      console.log('Screenshot complete!')
      camera.cleanup()
      bot.quit()
    } catch (err) {
      console.error('Error taking screenshot:', err)
      bot.quit()
      process.exit(1)
    }
  })

  bot.on('error', (err) => {
    console.error('Bot error:', err)
    process.exit(1)
  })

  bot.on('kicked', (reason) => {
    console.log('Bot was kicked:', reason)
    process.exit(1)
  })
}

// Export Camera class for use as a module
module.exports = { Camera }

// Run main function if executed directly
if (require.main === module) {
  main()
}
