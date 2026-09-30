import { createPostHogRequestErrorReporter } from "@hraness/posthog/server";
import { textbutlerPostHogSite } from "./app/_lib/analytics";

export const onRequestError = createPostHogRequestErrorReporter({
  apiHost: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  site: textbutlerPostHogSite,
});
