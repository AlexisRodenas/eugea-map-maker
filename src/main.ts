import './style.css';
import { App } from './app';

declare global {
  interface Window {
    app: App;
  }
}

window.app = new App();
