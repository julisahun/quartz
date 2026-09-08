import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { startPlugins } from './plugins'
import { registerNoteCommands } from './ui/actions'
import './styles.css'

registerNoteCommands()
startPlugins()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
