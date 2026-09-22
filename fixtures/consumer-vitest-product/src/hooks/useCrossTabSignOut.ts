import { useCallback, useEffect, useRef, useState } from 'react'

const AUTH_CHANNEL = 'auth'
const SIGNED_OUT_MESSAGE = 'signed-out'

/** Keeps every open tab's session in sync: a sign-out in one tab signs the others out.
 * BroadcastChannel never delivers a message back to the instance that posted it, so this tab stays unaffected by its own announcement.
 * @returns
 * - signedOutElsewhere: true after another tab announced a sign-out
 * - signOutEverywhere: announces this tab's sign-out to the other tabs
 * @example const { signedOutElsewhere, signOutEverywhere } = useCrossTabSignOut()
 */
export function useCrossTabSignOut() {
  const [signedOutElsewhere, setSignedOutElsewhere] = useState(false)
  const channelRef = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    const channel = new BroadcastChannel(AUTH_CHANNEL)
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === SIGNED_OUT_MESSAGE) setSignedOutElsewhere(true)
    }
    channelRef.current = channel
    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [])

  const signOutEverywhere = useCallback(() => {
    channelRef.current?.postMessage(SIGNED_OUT_MESSAGE)
  }, [])

  return { signedOutElsewhere, signOutEverywhere }
}
