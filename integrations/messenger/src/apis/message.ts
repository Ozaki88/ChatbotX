import { DEFAULT_API_VERSION } from "../constants"
import { rescue } from "../exception"
import { facebookGraphClient } from "../lib/http-client"
import type {
  FacebookSendMessageRequest,
  FacebookSendMessageResponse,
  MessengerAuthValue,
} from "../schema"

export const sendMessage = (
  auth: MessengerAuthValue,
  payload: FacebookSendMessageRequest,
): Promise<FacebookSendMessageResponse> => {
  const { version = DEFAULT_API_VERSION } = auth
  const endpoint = `${version}/me/messages`

  const send = () =>
    facebookGraphClient.post<FacebookSendMessageResponse>(endpoint, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.tokens.accessToken}`,
      },
      json: payload,
      retry: 0,
    })

  return rescue(endpoint, async () => {
    try {
      return await send()
    } catch (error) {
      // A dropped connection (ECONNRESET) never reached a Graph answer, so the
      // message was lost: try once more instead of failing the person's tap.
      if (!isNetworkError(error)) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAY_MS))
      return await send()
    }
  })
}

const NETWORK_RETRY_DELAY_MS = 2000

function isNetworkError(error: unknown): boolean {
  return (
    error instanceof Error && /network error/i.test(error.message)
  )
}
