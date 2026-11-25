// Shared with the phone app, which raises the same notifications as local ones.
export {
  createThreadNotificationGate,
  isSnoozedForNotification,
  RELEASED_COMPLETION_GRACE_MS,
  type ThreadNotificationKind,
  type ThreadNotificationObservation,
} from "@t3tools/client-runtime/state/thread-notification-gate";
