import { reactive } from 'vue'

type DialogKind = 'prompt' | 'confirm'

interface DialogOptions {
  kind: DialogKind
  title: string
  message: string
  placeholder?: string
  defaultValue?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface DialogState extends DialogOptions {
  visible: boolean
  inputValue: string
  resolve: ((value: string | boolean | null) => void) | null
}

export const dialogState = reactive<DialogState>({
  visible: false,
  kind: 'confirm',
  title: '',
  message: '',
  placeholder: '',
  defaultValue: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
  inputValue: '',
  resolve: null,
})

function openDialog(options: DialogOptions): Promise<string | boolean | null> {
  return new Promise(resolve => {
    Object.assign(dialogState, {
      ...options,
      visible: true,
      inputValue: options.defaultValue ?? '',
      confirmText: options.confirmText ?? '确定',
      cancelText: options.cancelText ?? '取消',
      resolve,
    })
  })
}

export function useDialog() {
  return {
    prompt(options: Omit<DialogOptions, 'kind'>) {
      return openDialog({ ...options, kind: 'prompt' }) as Promise<string | null>
    },
    confirm(options: Omit<DialogOptions, 'kind'>) {
      return openDialog({ ...options, kind: 'confirm' }) as Promise<boolean>
    },
  }
}

export function resolveDialog(confirmed: boolean) {
  const resolver = dialogState.resolve
  const value = confirmed
    ? dialogState.kind === 'prompt'
      ? dialogState.inputValue
      : true
    : dialogState.kind === 'prompt'
      ? null
      : false

  dialogState.visible = false
  dialogState.resolve = null
  if (resolver) resolver(value)
}
