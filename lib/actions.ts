export type ActionState<T = null> = {
  success: boolean
  data?: T
  error?: string
}
