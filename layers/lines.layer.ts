import { CompositeLayer } from '@deck.gl/core/typed'

import { PathLayer } from '@deck.gl/layers/typed'
import type { Line } from '~/types'

class LineLayer extends CompositeLayer<{ id: string; data: Line; selected?: boolean }> {
  renderLayers() {
    const id = this.props.id
    const line = this.props.data
    const selected = this.props.selected

    if (!line)
      return []
    return [
      new PathLayer<[number, number][]>({
        id: `${id}${line.id}polyline${selected && 'selected'}`,
        data: [line.polyline],
        getColor: line.color,
        autoHighlight: false,
        widthScale: 15,
        widthMinPixels: selected ? 5 : 2,
        widthMaxPixels: selected ? 7 : 3,
        pickable: true,

        getPath: () => line.polyline,
      }),
    ]
  }
}
LineLayer.layerName = 'LineLayer'
LineLayer.defaultProps = {
  pickable: true,
  autoHighlight: true,
}

export default LineLayer
