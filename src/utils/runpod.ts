/**
 * RunPod Auto-Stop Utility
 * Stops the current RunPod pod after pipeline completes to save costs.
 */
import https from "https";

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || "";
const RUNPOD_POD_ID = process.env.RUNPOD_POD_ID || "";

export function isRunPod(): boolean {
  return !!(RUNPOD_API_KEY && RUNPOD_POD_ID);
}

/**
 * Stop the current RunPod pod via API.
 * Only works when running on RunPod with RUNPOD_API_KEY and RUNPOD_POD_ID set.
 */
export async function stopPod(): Promise<void> {
  if (!RUNPOD_API_KEY || !RUNPOD_POD_ID) {
    return; // Not on RunPod, skip
  }

  console.log("\n  [RunPod] Pipeline complete — stopping pod to save costs...");
  console.log(`  [RunPod] Pod ID: ${RUNPOD_POD_ID}`);

  const body = JSON.stringify({
    query: `mutation { podStop(input: { podId: "${RUNPOD_POD_ID}" }) { id desiredStatus } }`,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.runpod.io",
        path: `/graphql?api_key=${RUNPOD_API_KEY}`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          if (res.statusCode === 200) {
            console.log("  [RunPod] Pod stop requested — it will shut down in ~10 seconds.");
            console.log("  [RunPod] Your output is saved. Restart the pod to access it.\n");
          } else {
            console.error(`  [RunPod] Failed to stop pod: ${data}`);
          }
          resolve();
        });
      }
    );
    req.on("error", (err) => {
      console.error(`  [RunPod] Error stopping pod: ${err.message}`);
      resolve(); // Don't fail the pipeline over this
    });
    req.write(body);
    req.end();
  });
}
