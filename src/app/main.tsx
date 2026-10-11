import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../ui/tokens.css'
import '../ui/fonts.css'
import '../ui/ui.css'
import '../ui/print.css'
import './app.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
