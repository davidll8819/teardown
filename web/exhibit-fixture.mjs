// Deterministic, hand-authored regression fixture ONLY. This is the original
// repository's V8 model, not model-generated output and not a user-job fallback.
// Keep it out of generation prompts/results and the production app entry point.
import {buildEngine} from '../sims/v8-shared/engine.js';
import {piston, psi, pressure, liftIn, liftEx, VALVE, S_TDC, STROKE} from '../sims/v8-shared/kin.js';
import {createMechanicalExhibit} from './simulator-exhibit.js';

export const EXHIBIT_FIXTURE_PROVENANCE = Object.freeze({
  kind: 'hand-authored-regression-fixture',
  model: 'sims/v8-shared/engine.js',
  kinematics: 'sims/v8-shared/kin.js',
  generated: false,
});

export function createExhibitFixture(container) {
  const engine = buildEngine();
  const block = engine.root.children[0];
  const parts = [
    {id: 'block', label: '机体与曲轴箱', object: block, cutaway: true, explode: [0, -220, 0], description: 'V 形机体支撑两列气缸与曲轴主轴承。剖切模式移除机体，以显露曲轴及连杆。'},
    {id: 'crank', label: '十字曲轴', object: engine.crank, explode: [0, -100, 0], description: '四组相隔 90° 的曲柄带动八根连杆，将活塞的往复运动转换为转动。'},
    {id: 'cam-left', label: '左列凸轮轴', object: engine.cams[0].g, explode: [170, 170, 0], description: '凸轮轴以曲轴一半的转速运行，驱动进、排气门。气门升程与当前四冲程相位同步。'},
    {id: 'cam-right', label: '右列凸轮轴', object: engine.cams[1].g, explode: [-170, 170, 0], description: '右列凸轮轴与右侧气缸共用相位模型；每两转曲轴完成一次进气、压缩、做功、排气循环。'},
    {id: 'cylinder-one', label: '1 号气缸总成', object: engine.cyl[0].g, explode: [90, 90, 0], description: '透明缸套、活塞、缸盖和气门展示第一缸的运动。左侧位移与升程读数直接来自同一个运动学状态。'},
    {id: 'cylinder-two', label: '2 号气缸总成', object: engine.cyl[1].g, explode: [-90, 90, 0], description: '第二缸沿另一列气缸轴线运动。与第一缸的相位差遵循原模型的 1–8–4–3–6–5–7–2 点火顺序。'},
    {id: 'pulley', label: '前端皮带轮', object: engine.pulley, explode: [0, 0, 180], description: '皮带轮与曲轴同轴、同速旋转。爆炸模式沿轴线分离，保留它自身的旋转中心。'},
    {id: 'flywheel', label: '后端飞轮', object: engine.flywheel, explode: [0, 0, -180], description: '飞轮固定在曲轴后端，和曲轴保持相同角度。此教学模型展示几何运动，不估算真实惯性或输出功率。'},
  ];
  const exhibit = createMechanicalExhibit({
    container,
    title: 'Cross-plane V8 / 机械研究',
    subtitle: '固定测试样机 · 原仓库 V8 机构，非 AI 生成 · 压力为教学近似',
    root: engine.root,
    parts,
    parameters: [{id: 'rpm', label: '演示转速', value: 12, min: 0, max: 60, step: 1, unit: 'rpm'}],
    readouts: [
      {id: 'crank-angle', label: '曲轴角度', key: 'angle', unit: '°', min: 0, max: 720, digits: 1},
      {id: 'piston-travel', label: '1 缸距上止点', key: 'pistonTravel', unit: 'mm', min: 0, max: STROKE, digits: 2},
      {id: 'intake-lift', label: '1 缸进气升程', key: 'intakeLift', unit: 'mm', min: 0, max: VALVE.lift, digits: 2},
      {id: 'chamber-pressure', label: '1 缸压力（近似）', key: 'pressure', unit: 'bar', min: 0, max: 60, digits: 1},
    ],
    model: ({time, parameters}) => {
      const angle = ((time * parameters.rpm * 6) % 720 + 720) % 720;
      const phase = psi(1, angle);
      return {
        angle,
        pistonTravel: S_TDC - piston(0, angle).s,
        intakeLift: liftIn(phase) * VALVE.lift,
        exhaustLift: liftEx(phase) * VALVE.lift,
        pressure: pressure(phase),
      };
    },
    update: state => engine.update(state.angle, {charge: 0.7, arrows: 0, explode: 0}),
    tour: [
      {label: '整体运转', duration: 8, mode: 'assembled', view: 'perspective'},
      {label: '曲柄与连杆', duration: 7, mode: 'cutaway', view: 'front'},
      {label: '装配层次', duration: 9, mode: 'exploded', view: 'perspective'},
      {label: '两列气缸', duration: 6, mode: 'cutaway', view: 'top'},
    ],
  });
  let disposed = false;
  return Object.freeze({...exhibit, dispose() {
    if (disposed) return;
    disposed = true;
    exhibit.dispose();
    const geometries = new Set(), materials = new Set(Object.values(engine.M));
    engine.root.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
  }});
}
