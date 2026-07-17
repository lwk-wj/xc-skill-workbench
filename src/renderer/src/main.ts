import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/tokens.css'
import './styles/app.css'
import App from './App.vue'

const root = document.getElementById('root')
if (!root) throw new Error('Renderer root element is missing')

createApp(App).use(createPinia()).use(ElementPlus).mount(root)
