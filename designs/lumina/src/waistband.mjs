import { shape } from './shape.mjs'

export const waistband = {
  name: 'lumina.waistband',
  after: shape,
  draft: ({
    store,
    sa,
    Point,
    points,
    Path,
    paths,
    Snippet,
    snippets,
    options,
    measurements,
    macro,
    log,
    utils,
    part,
  }) => {
    if (false === options.waistband) {
      return part.hide()
    }

    const waistLength = store.get('waistLength')
    const waistbandBackLength = store.get('waistbandBackLength')
    const waistbandFrontLength = store.get('waistbandFrontLength')
    const waistbandPanelLength = store.get('waistbandPanelLength')
    const waistbandLength = store.get('waistbandLength')
    const waistbandSize = store.get('waistbandSize')
    const waistLowering = store.get('waistLowering')
    if (waistbandSize <= 0) {
      return part.hide()
    }

    points.origin = new Point(0, 0) //.addCircle(3)

    const angleRad = Math.asin((Math.abs(waistbandLength - waistLength) * 0.5) / waistbandSize)
    const radius = (waistLength * 0.5) / Math.sin(angleRad)
    const baseAngle = waistLength < waistbandLength ? 270 : 90
    let angle = utils.rad2deg(angleRad)

    let diff = 0
    let iter = 0
    let segments, cpDistance
    do {
      angle += diff * 0.025
      segments = 360 / angle

      cpDistance = (4 / 3) * Math.tan(Math.PI / (segments * 2)) * radius

      points.waistFront = points.origin.shift(baseAngle + angle, radius)
      points.waistBack = points.origin.shift(baseAngle - angle, radius)
      points.waistFrontCP = points.waistFront.shift(baseAngle - 90 + angle, cpDistance)
      points.waistBackCP = points.waistBack.shift(baseAngle + 90 - angle, cpDistance)

      paths.waist = new Path()
        .move(points.waistBack)
        .curve(points.waistBackCP, points.waistFrontCP, points.waistFront)

      diff = waistLength - paths.waist.length()
    } while (iter++ < 100 && (diff < -0.5 || diff > 0.5))
    if (iter >= 100) {
      log.info('lumina:couldNoFitWaistband')
      return part.hide()
    }

    points.waistbandFront = points.waistFront.shift(270 + angle, waistbandSize)
    points.waistbandBack = points.waistBack.shift(270 - angle, waistbandSize)

    cpDistance =
      (4 / 3) *
      Math.tan(Math.PI / (segments * 2)) *
      (radius + waistbandSize * (waistLength < waistbandLength ? 1 : -1))
    points.waistbandFrontCP = points.waistbandFront.shift(baseAngle - 90 + angle, cpDistance)
    points.waistbandBackCP = points.waistbandBack.shift(baseAngle + 90 - angle, cpDistance)

    paths.waistband = new Path()
      .move(points.waistbandBack)
      .curve(points.waistbandBackCP, points.waistbandFrontCP, points.waistbandFront)

    diff = waistbandLength - paths.waistband.length()
    const rWaistband = paths.waistband.reverse()
    points.snippetPanelBack = rWaistband.shiftAlong(waistbandFrontLength + waistbandPanelLength)
    snippets.panelBack = new Snippet('notch', points.snippetPanelBack)
    points.snippetPanelFront = rWaistband.shiftAlong(waistbandFrontLength)
    snippets.panelFront = new Snippet('notch', points.snippetPanelFront)

    if (options.lowerwaistbandback) {
      paths.waistband = rWaistband.split(points.snippetPanelBack)[0]
      points.waistbandBackPanel = points.snippetPanelBack.copy()
      points.waistbandBackPanelCP = points.snippetPanelFront.shiftFractionTowards(
        points.waistbandBackPanel,
        1.4
      )
      points.waistbandBack = points.waistBack.shiftOutwards(
        points.waistbandBack,
        (waistLowering + waistbandSize) * 0.5
      )
      paths.waistband = new Path()
        .move(points.waistbandBack)
        ._curve(points.waistbandBackPanelCP, points.waistbandBackPanel)
        .join(paths.waistband.reverse())
    }

    paths.seamSA = new Path()
      .move(points.waistFront)
      .join(paths.waist.reverse())
      .line(points.waistbandBack)
      .join(paths.waistband)
      .hide()

    paths.seam = new Path().move(points.waistbandFront).line(points.waistFront).join(paths.seamSA)

    if (sa) {
      const seamSA = paths.seamSA.offset(sa)
      paths.sa = new Path()
        .move(points.waistFront)
        .line(seamSA.start())
        .join(seamSA)
        .line(points.waistbandFront)
        .attr('class', 'fabric sa')
    }

    return part
  },
}
