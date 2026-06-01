export async function callExternalApi() {
  const apiKey = process.env.API_KEY;
  // Use a host that matches a known third-party (stripe) so the
  // external_api_call pattern plus classifier will produce a third_party
  // component and a corresponding data flow in tests.
  const response = await fetch("https://api.stripe.com/v1/customers", {
    headers: {
      "x-api-key": apiKey ?? "test-key",
    },
  });
  if (!response.ok) {
    throw new Error("API request failed");
  }
  return response.json();
}

