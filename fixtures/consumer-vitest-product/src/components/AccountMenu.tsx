import { useCrossTabSignOut } from '@/hooks/useCrossTabSignOut'

type AccountMenuProps = {
  userName: string
}

/** Header account menu that reacts when the user signs out in another browser tab.
 * @param props - Name of the signed-in user.
 * @returns The signed-in user and a sign-out button, or a status after another tab signed out.
 * @example <AccountMenu userName="Raphtalia" />
 */
export function AccountMenu({ userName }: AccountMenuProps) {
  const { signedOutElsewhere, signOutEverywhere } = useCrossTabSignOut()
  if (signedOutElsewhere) {
    return <p role="status">You signed out in another tab.</p>
  }
  return (
    <div>
      <p>Signed in as {userName}</p>
      <button type="button" onClick={signOutEverywhere}>
        Sign out everywhere
      </button>
    </div>
  )
}
