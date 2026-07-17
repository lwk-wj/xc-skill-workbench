import { render, type RenderOptions } from '@testing-library/vue'
import ElementPlus from 'element-plus'
import { createPinia } from 'pinia'

export function renderTestApp<C>(component: C, options: RenderOptions<C> = {}) {
  return render(component, {
    ...options,
    global: {
      ...options.global,
      plugins: [createPinia(), ElementPlus, ...(options.global?.plugins ?? [])],
    },
  })
}
