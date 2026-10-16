export async function submitCancelAction({
  confirmCancel,
  isPending,
  cancel,
  setConfirmCancel,
  onCancelled,
}: {
  confirmCancel: boolean;
  isPending: boolean;
  cancel: () => Promise<unknown>;
  setConfirmCancel: (value: boolean) => void;
  onCancelled: () => void;
}) {
  if (isPending) return;

  if (!confirmCancel) {
    setConfirmCancel(true);
    return;
  }

  await cancel();
  setConfirmCancel(false);
  onCancelled();
}
