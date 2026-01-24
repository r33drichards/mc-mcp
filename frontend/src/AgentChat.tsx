import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const AGENT_URL = '/api/agent'

export function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hi! I can help you control the Minecraft bot. Try asking me to connect to the server, look around, or find resources!",
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = { role: 'user', content: input.trim() }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const response = await fetch(AGENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }

      const data = await response.json()
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.response || 'I received your message but had trouble processing it.',
      }
      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error('Error sending message:', error)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : 'Failed to send message'}`,
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#1a1a2e',
        color: '#eee',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid #333',
          backgroundColor: '#16213e',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '16px' }}>Minecraft Bot Agent</h3>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
        }}
      >
        {messages.map((msg, idx) => (
          <div
            key={idx}
            style={{
              marginBottom: '12px',
              padding: '10px 14px',
              borderRadius: '8px',
              backgroundColor: msg.role === 'user' ? '#0f3460' : '#1a1a2e',
              border: msg.role === 'assistant' ? '1px solid #333' : 'none',
              maxWidth: '90%',
              marginLeft: msg.role === 'user' ? 'auto' : '0',
              whiteSpace: 'pre-wrap',
            }}
          >
            <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '4px' }}>
              {msg.role === 'user' ? 'You' : 'Bot'}
            </div>
            <div>{msg.content}</div>
          </div>
        ))}
        {isLoading && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              backgroundColor: '#1a1a2e',
              border: '1px solid #333',
              opacity: 0.7,
            }}
          >
            <div style={{ fontSize: '12px', marginBottom: '4px' }}>Bot</div>
            <div>Thinking...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        style={{
          padding: '16px',
          borderTop: '1px solid #333',
          backgroundColor: '#16213e',
        }}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask the bot to do something..."
            disabled={isLoading}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #333',
              backgroundColor: '#1a1a2e',
              color: '#eee',
              fontSize: '14px',
              outline: 'none',
            }}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: isLoading || !input.trim() ? '#333' : '#e94560',
              color: '#fff',
              fontSize: '14px',
              cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
