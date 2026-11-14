import { render } from 'preact'
import { App } from './app/App'
import { initPwa } from './pwa'
import { requestPersistentStorage } from './storage/db'
import './app/styles.css'

initPwa()
void requestPersistentStorage()
render(<App />, document.getElementById('app')!)
