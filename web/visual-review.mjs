/** Inspect an isolated renderer's output using a vision-capable gateway model. */
export function createVisualReviewer({render, gateway}) {
  if (typeof render !== 'function' || !gateway?.complete) throw new Error('visual_configuration_invalid');
  return async ({html, description, signal}) => {
    if (signal?.aborted) throw new Error('cancelled');
    const result = await render({html, signal});
    if (!Number.isInteger(result?.canvasCount) || !Array.isArray(result.errors) || typeof result.image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(result.image) || result.image.length > 3_000_000) throw new Error('visual_response_invalid');
    if (result.canvasCount < 1 || result.errors.length) return {passed: false, feedback: result.canvasCount < 1 ? 'No canvas was rendered.' : 'The page raised a JavaScript error during rendering.'};
    const response = await gateway.complete({signal, messages: [
      {role: 'system', content: 'Assess a screenshot of an educational 3D mechanical exhibit. Return only JSON with boolean passed and a concise, actionable feedback string (at most 1000 characters). Fail if the subject is absent/blank, clearly unrelated, clipped offscreen, obscured by UI, or consists only of crude generic primitives without recognizable mechanical subassemblies. Inspect silhouette, meaningful mating parts, bores/edges/secondary geometry, distinguishable materials, controlled lighting, readable labels, and adequate space for the model. Reject obvious intersections, floating disconnected parts in an assembled view, blown highlights hiding details, or tiny unreadable controls. An intentional exploded view may separate parts along clear assembly directions. Name the most important concrete repairs, not vague requests for more polish. Judge only visible evidence: one screenshot cannot establish motion, functional controls, internal accuracy, CAD validity, printability or physical assembly. Never claim those were tested.'},
      {role: 'user', content: [{type: 'text', text: `Requested mechanism: ${description}`}, {type: 'image_url', image_url: {url: `data:image/jpeg;base64,${result.image}`}}]},
    ]});
    let review;
    try { review = JSON.parse(response.content); } catch { throw new Error('visual_review_invalid'); }
    if (typeof review?.passed !== 'boolean' || typeof review.feedback !== 'string' || review.feedback.length > 1000) throw new Error('visual_review_invalid');
    return {passed: review.passed, feedback: review.feedback};
  };
}
