import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { startThemaMotor } from './lib/theme'
import './styles/theme.css'
import './styles/auth.css'

/*
 * Het thema zetten voordat React iets tekent. Anders zie je bij een lichte
 * instelling eerst een donkere flits, en dat oogt als een storing.
 */
startThemaMotor()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
