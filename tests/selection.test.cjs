const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const pinia = require('pinia')
const { parse, compileScript } = require('@vue/compiler-sfc')

const root = path.resolve(__dirname, '..')
const cities = [
  { id: '4401', name: '广州', lines: [{ id: 'a', cityId: '4401', name: '1号线', stations: [] }, { id: 'b', cityId: '4401', name: '2号线', stations: [] }] },
  { id: '4403', name: '深圳', lines: [{ id: 'c', cityId: '4403', name: '1号线', stations: [] }] },
]

function evaluate(source, dependencies = {}) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(output, {
    exports,
    require: name => dependencies[name] || require(name),
    ref: vue.ref,
    computed: vue.computed,
    watch: vue.watch,
    useDataset: () => vue.ref(structuredClone(cities)),
  })
  return exports
}

function setup() {
  pinia.setActivePinia(pinia.createPinia())
  const load = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/if \(import\.meta\.hot\)[\s\S]*$/, '')
  const interactorModule = evaluate(load('store/interactor.store.ts'))
  const appModule = evaluate(load('store/app.store.ts'), { './interactor.store': interactorModule })
  const subwayModule = evaluate(load('utils/subway.ts'))
  return { app: appModule.useAppStore(), interaction: interactorModule.useInteractorStore(), interactorModule, appModule, subwayModule }
}

test('城市默认单选，普通点击替换选择', () => {
  const { app } = setup()
  assert.equal(app.cityMultiSelect, false)
  assert.equal(app.selectedCities.size, 1)
  app.selectCity(app.dataset[1])
  assert.deepEqual([...app.selectedCities].map(city => city.id), ['4403'])
})

test('城市 Ctrl 多选可添加和移除，松开后普通点击恢复单选', () => {
  const { app } = setup()
  app.selectCity(app.dataset[1], true)
  assert.equal(app.selectedCities.size, 2)
  assert.equal(app.cityMultiSelect, false)
  app.selectCity(app.dataset[0], true)
  assert.equal(app.selectedCities.size, 1)
  app.selectCity(app.dataset[0])
  assert.deepEqual([...app.selectedCities].map(city => city.id), ['4401'])
})

test('城市多选按钮与全选，退出多选保留最后一项', () => {
  const { app } = setup()
  app.toggleCityMultiSelect()
  app.selectCity(app.dataset[1])
  assert.equal(app.selectedCities.size, 2)
  app.selectAllCities()
  assert.equal(app.selectedCities.size, 0)
  app.selectAllCities()
  assert.equal(app.selectedCities.size, app.dataset.length)
  app.toggleCityMultiSelect()
  assert.equal(app.selectedCities.size, 1)
  assert.equal(app.cityMultiSelect, false)
})

test('线路单选、Ctrl 多选、移除和恢复单选', () => {
  const { interaction } = setup()
  const [a, b] = cities[0].lines
  interaction.selectLine(a)
  interaction.selectLine(b)
  assert.deepEqual(Array.from(interaction.focusedLines, line => line.id), ['b'])
  interaction.selectLine(a, true)
  assert.equal(interaction.focusedLines.length, 2)
  interaction.selectLine(b, true)
  assert.deepEqual(Array.from(interaction.focusedLines, line => line.id), ['a'])
  interaction.selectLine(b)
  assert.deepEqual(Array.from(interaction.focusedLines, line => line.id), ['b'])
})

test('线路全选与取消全选保留其他城市选择', () => {
  const { interaction } = setup()
  interaction.toggleLineMultiSelect()
  interaction.selectLine(cities[1].lines[0])
  interaction.selectAllLines(cities[0].lines)
  assert.equal(interaction.focusedLines.length, 3)
  interaction.selectAllLines(cities[0].lines)
  assert.deepEqual(Array.from(interaction.focusedLines, line => line.id), ['c'])
  interaction.toggleLineMultiSelect()
  assert.equal(interaction.focusedLines.length, 1)
})

test('移除城市清理所属线路、悬停和详情，保留其他城市线路', () => {
  const { app, interaction } = setup()
  app.selectAllCities()
  interaction.selectAllLines(app.dataset[0].lines)
  interaction.selectAllLines(app.dataset[1].lines)
  app.setDetailCity(app.dataset[0])
  app.selectCity(app.dataset[0])
  assert.deepEqual(Array.from(interaction.focusedLines, line => line.id), ['c'])
  assert.equal(app.detailCity, null)
  assert.equal(interaction.hoveringLine, null)
})

test('站点面板下拉框切换线路，移除当前线路后自动回退，清空后关闭', async () => {
  const { interaction, interactorModule, appModule, subwayModule } = setup()
  interaction.selectAllLines(cities[0].lines)
  const { descriptor } = parse(fs.readFileSync(path.join(root, 'components/LineDetail.vue'), 'utf8'))
  const script = compileScript(descriptor, { id: 'line-detail-test' })
  const component = evaluate(script.content, {
    '~/store/interactor.store': interactorModule,
    '~/store/app.store': appModule,
    '~/utils/subway': subwayModule,
    '@oku-ui/motion': {},
  }).default
  const scope = vue.effectScope()
  const panel = scope.run(() => component.setup({}, { expose() {}, emit() {} }))
  assert.equal(panel.displayedLine.value.id, 'b')
  panel.displayedLineId.value = 'a'
  assert.equal(panel.displayedLine.value.id, 'a')
  interaction.selectLine(cities[0].lines[0])
  await vue.nextTick()
  assert.equal(panel.displayedLine.value.id, 'b')
  interaction.reset()
  await vue.nextTick()
  assert.equal(panel.displayedLine.value, undefined)
  scope.stop()
})

test('城市与线路在单选模式下再次点击也取消选择', () => {
  const { app, interaction } = setup()
  app.selectCity(app.dataset[0])
  assert.equal(app.selectedCities.size, 0)
  app.selectCity(app.dataset[0])
  interaction.selectLine(app.dataset[0].lines[0])
  interaction.selectLine(app.dataset[0].lines[0])
  assert.equal(interaction.focusedLines.length, 0)
})

test('线路显示按城市独立判断，A市清空不影响B市选择', () => {
  const { interaction, subwayModule } = setup()
  interaction.selectLine(cities[0].lines[0], true)
  interaction.selectLine(cities[1].lines[0], true)
  assert.equal(subwayModule.hasCityLineSelection(interaction.focusedLines, '4401'), true)
  interaction.selectLine(cities[0].lines[0])
  assert.equal(subwayModule.hasCityLineSelection(interaction.focusedLines, '4401'), false)
  assert.equal(subwayModule.hasCityLineSelection(interaction.focusedLines, '4403'), true)
})

test('选中线路仍可悬停，换乘站包含未选中的同城线路', () => {
  const { app, interaction, subwayModule } = setup()
  const station = { id: 'shared', name: '换乘站', coord: [113, 23] }
  app.dataset[0].lines[0].stations = [station]
  app.dataset[0].lines[1].stations = [{ ...station, id: 'another-id' }]
  app.dataset[1].lines[0].stations = [station]
  const line = app.dataset[0].lines[0]
  interaction.selectLine(line)
  interaction.setHoveringLine(line)
  interaction.setHoveringStation(station, line)
  assert.equal(interaction.hoveringLine.id, line.id)
  assert.equal(interaction.hoveringStation.name, station.name)
  assert.deepEqual(Array.from(subwayModule.getStationLines(app.dataset, line, station), item => item.id), ['a', 'b'])
  assert.equal(subwayModule.getLineLabel(app.dataset, line), '广州 · 1号线')
  assert.equal(subwayModule.getLineLabel(app.dataset, app.dataset[1].lines[0]), '深圳 · 1号线')
})

test('真实数据公园前换乘站包含广州1号线和2号线', () => {
  const { subwayModule } = setup()
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'datasource/data.json'), 'utf8'))
  const dataset = raw.map(city => ({ ...city, lines: city.lines.map(line => ({ ...line, cityId: city.id })) }))
  const city = dataset.find(city => city.id === '4401')
  const line = city.lines.find(line => line.name === '1号线')
  const station = line.stations.find(station => station.name === '公园前')
  const names = subwayModule.getStationLines(dataset, line, station).map(line => line.name)
  assert.deepEqual(Array.from(names), ['1号线', '2号线'])
})
