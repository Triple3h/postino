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
  /** 第三按钮文案(如「不保存」);提供后确认弹窗变为三选 */
  tertiaryText?: string
  danger?: boolean
}

interface DialogState extends DialogOptions {
  visible: boolean
  inputValue: string
  resolve: ((value: string | boolean | null) => void) | null
}

/** 三选确认弹窗的返回值 */
export type ConfirmTertiaryResult = 'confirm' | 'tertiary' | 'cancel'

export const dialogState = reactive<DialogState>({
  visible: false,
  kind: 'confirm',
  title: '',
  message: '',
  placeholder: '',
  defaultValue: '',
  confirmText: '确定',
  cancelText: '取消',
  tertiaryText: '',
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
    /** 三选确认:confirmText / tertiaryText / cancelText 分别对应 confirm / tertiary / cancel */
    confirmTertiary(options: Omit<DialogOptions, 'kind'>): Promise<ConfirmTertiaryResult> {
      return openDialog({ ...options, kind: 'confirm', tertiaryText: options.tertiaryText ?? '' }).then(value => {
        if (value === 'tertiary') return 'tertiary'
        return value ? 'confirm' : 'cancel'
      })
    },
  }
}

export function resolveDialog(result: boolean | 'tertiary') {
  const resolver = dialogState.resolve
  const value: string | boolean | null = result === 'tertiary'
    ? 'tertiary'
    : dialogState.kind === 'prompt'
      ? (result ? dialogState.inputValue : null)
      : result

  dialogState.visible = false
  dialogState.resolve = null
  if (resolver) resolver(value)
}
