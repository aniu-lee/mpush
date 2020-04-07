interface TypeObject<T> {
  [key: string]: T
}
type MessageStatus = 'ready' | 'ok' | 'wait' | 'fcm' | 'fcm-wait' | 'no'