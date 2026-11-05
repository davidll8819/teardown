// Fixed checks executed only by a separately isolated browser worker. Generated
// pages cannot choose the actions, URLs, output paths or executable commands.
// These checks cover the presentation controls, not physical accuracy.
export async function inspectExhibit(page) {
  const checks = [];
  const failures = [];
  const frames = [];
  const check = (name, passed) => {
    if (passed) { if (!failures.includes(name) && !checks.includes(name)) checks.push(name); }
    else { if (!failures.includes(name)) failures.push(name); const index = checks.indexOf(name); if (index >= 0) checks.splice(index, 1); }
  };
  const readSnapshot = () => page.evaluate(() => {
    const api = window.__TEARDOWN_EXHIBIT__;
    if (!api || typeof api.snapshot !== 'function') return null;
    const state = api.snapshot();
    // Read only the finite, bounded fields needed for the fixed checks.
    return {
      time: Number.isFinite(state.time) ? state.time : null,
      paused: state.paused === true,
      modelError: state.error !== null && state.error !== undefined,
      disposed: state.disposed === true,
      partsOverflow: !Array.isArray(state.parts) || state.parts.length > 64,
      readoutsOverflow: !state.readouts || typeof state.readouts !== 'object' || Object.keys(state.readouts).length > 32,
      mode: String(state.mode).slice(0, 24),
      tour: {active: state.tour?.active === true, enabled: state.tour?.enabled === true},
      parts: Array.isArray(state.parts) ? state.parts.slice(0, 64).map(part => ({
        id: String(part.id).slice(0, 80), visible: part.visible === true, cutaway: part.cutaway === true,
        offset: Array.isArray(part.offset) ? part.offset.slice(0, 3).map(value => Number.isFinite(value) ? value : null) : [],
      })) : [],
      readouts: Object.fromEntries(Object.entries(state.readouts || {}).slice(0, 32).map(([key, value]) => [key.slice(0, 80), Number.isFinite(value) ? value : null])),
    };
  });
  const snapshot = async () => {
    const state = await readSnapshot();
    check('runtime_state_valid', !!state && !state.modelError && !state.disposed && !state.partsOverflow && !state.readoutsOverflow && Object.keys(state.readouts).length > 0 && Object.values(state.readouts).every(value => value !== null));
    return state;
  };
  const click = async action => {
    const control = page.locator(`[data-exhibit-action="${action}"]`);
    if (await control.count() !== 1 || !await control.isVisible()) throw new Error(`missing_${action}_control`);
    await control.click({timeout: 1500});
    await page.waitForTimeout(160);
  };
  const capture = async mode => {
    const bytes = await page.screenshot({type: 'jpeg', quality: 65, timeout: 3000});
    frames.push({mode, image: bytes.toString('base64')});
  };
  try {
    await page.waitForFunction(() => typeof window.__TEARDOWN_EXHIBIT__?.snapshot === 'function', null, {timeout: 3000});
    let state = await snapshot();
    check('runtime_mounted', !!state && state.parts.length > 0 && !state.modelError);
    if (!state) return {passed: false, checks, failures: ['runtime_missing'], frames};
    check('readouts_finite', Object.keys(state.readouts).length > 0 && Object.values(state.readouts).every(value => value !== null));
    if (!state.paused) await click('pause');
    const paused = await snapshot();
    await page.waitForTimeout(220);
    const still = await snapshot();
    check('pause_stops_clock', paused.paused && still.paused && paused.time !== null && paused.time === still.time);
    await click('pause');
    await page.waitForTimeout(220);
    state = await snapshot();
    check('resume_advances_clock', !state.paused && state.time > still.time);
    await click('pause');
    let assembled;
    for (const mode of ['assembled', 'cutaway', 'exploded']) {
      await click(mode);
      state = await snapshot();
      check(`${mode}_control`, state.mode === mode);
      if (mode === 'assembled') {
        assembled = state;
        check('assembled_alignment', state.parts.every(part => part.offset.length === 3 && part.offset.every(value => value === 0)));
      }
      if (mode === 'cutaway') check('cutaway_reveals_interior',
        state.parts.some(part => part.cutaway && !part.visible && assembled.parts.some(before => before.id === part.id && before.visible)) &&
        state.parts.some(part => !part.cutaway && part.visible));
      if (mode === 'exploded') check('exploded_moves_parts', state.parts.some(part => part.visible && part.offset.some(value => Number.isFinite(value) && Math.abs(value) > 0.00001)));
      await capture(mode);
    }
    await click('assembled');
    const toggles = page.locator('[data-exhibit-part]');
    if (await toggles.count()) {
      const id = await toggles.first().getAttribute('data-exhibit-part');
      const before = (await snapshot()).parts.find(part => part.id === id)?.visible;
      await toggles.first().click({timeout: 1500});
      await page.waitForTimeout(100);
      const after = (await snapshot()).parts.find(part => part.id === id)?.visible;
      check('subsystem_toggle', typeof before === 'boolean' && typeof after === 'boolean' && before !== after);
      await toggles.first().click({timeout: 1500});
    } else check('subsystem_toggle', false);
    await click('tour');
    state = await snapshot();
    check('tour_starts', state.tour.active);
    await capture('tour');
    await click('assembled');
    check('manual_control_takes_over', !(await snapshot()).tour.active);
  } catch (error) {
    const message = typeof error.message === 'string' && /^missing_[a-z_]+_control$/.test(error.message) ? error.message : 'runtime_check_failed';
    failures.push(message);
  }
  return {passed: failures.length === 0, checks, failures, frames};
}
