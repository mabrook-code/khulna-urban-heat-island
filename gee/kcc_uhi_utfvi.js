/*
 * Urban Heat Island and Thermal Mapping of Khulna City Corporation (KCC)
 * ---------------------------------------------------------------------
 * Author : Mabrook, Dept. of Urban & Regional Planning, KUET
 * Data   : Landsat 8 OLI/TIRS Collection 2, Level 2 (LANDSAT/LC08/C02/T1_L2)
 * Period : January – December 2024
 *
 * Steps:
 *   1. Apply Collection 2 scale factors
 *   2. Mask clouds, cloud shadows, cirrus, fill and saturated pixels
 *   3. Build an annual median composite
 *   4. Land Surface Temperature (LST) from the ST_B10 surface temperature band
 *   5. Normalized Urban Heat Island (UHI) index
 *   6. Urban Thermal Field Variance Index (UTFVI) and ecological classes
 *   7. NDVI and its correlation with LST (role of green space)
 *   8. Summary statistics and GeoTIFF exports
 *
 * Note: In Collection 2 Level 2, ST_B10 is already a surface temperature product
 * (atmospherically and emissivity corrected by USGS), so no extra emissivity
 * correction is applied here.
 */


// ===================== 0. Study area =====================
// KCC boundary. If you cannot access this asset, upload data/kcc_boundary.geojson
// to your own Earth Engine assets and replace the path below.
var aoi = ee.FeatureCollection('projects/ee-mabrook1/assets/KCC');
Map.centerObject(aoi, 12);

var SCALE = 30;            // Landsat pixel size (m)
var EXPORT_CRS = 'EPSG:32645';  // WGS 84 / UTM zone 45N (covers Khulna)


// ===================== 1. Scale factors =====================
function applyScaleFactors(image) {
  var opticalBands = image.select('SR_B.').multiply(0.0000275).add(-0.2);   // reflectance
  var thermalBands = image.select('ST_B.*').multiply(0.00341802).add(149.0); // Kelvin
  return image.addBands(opticalBands, null, true)
              .addBands(thermalBands, null, true);
}


// ===================== 2. Cloud and saturation masking =====================
function maskL8sr(image) {
  // QA_PIXEL bits 0–4: fill, dilated cloud, cirrus, cloud, cloud shadow.
  // Keep only pixels where all five bits are 0.
  var qaMask = image.select('QA_PIXEL').bitwiseAnd(parseInt('11111', 2)).eq(0);
  // QA_RADSAT = 0 means no band is saturated.
  var saturationMask = image.select('QA_RADSAT').eq(0);
  return image.updateMask(qaMask).updateMask(saturationMask);
}


// ===================== 3. Annual median composite =====================
var collection = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterDate('2024-01-01', '2025-01-01')
    .filterBounds(aoi)
    .map(applyScaleFactors)
    .map(maskL8sr);

print('Number of Landsat 8 scenes used:', collection.size());

var image = collection.median().clip(aoi);

Map.addLayer(image, {bands: ['SR_B4', 'SR_B3', 'SR_B2'], min: 0.03, max: 0.13},
             'True colour (4-3-2)', false);


// Helper: one statistic of a single-band image over the study area
function regionStat(img, reducer) {
  return ee.Number(img.reduceRegion({
    reducer: reducer,
    geometry: aoi,
    scale: SCALE,
    maxPixels: 1e9
  }).values().get(0));
}


// ===================== 4. Land Surface Temperature =====================
var lstK = image.select('ST_B10').rename('LST_K');          // Kelvin
var lst  = lstK.subtract(273.15).rename('LST');             // °C

var lstMean = regionStat(lst, ee.Reducer.mean());
var lstStd  = regionStat(lst, ee.Reducer.stdDev());

print('LST minimum (°C):', regionStat(lst, ee.Reducer.min()));
print('LST maximum (°C):', regionStat(lst, ee.Reducer.max()));
print('LST mean (°C):', lstMean);
print('LST standard deviation (°C):', lstStd);

var heatPalette = [
  '040274', '0502a3', '0502ce', '0602ff', '307ef3', '269db1', '30c8e2',
  '3be285', '86e26f', 'b5e22e', 'fff705', 'ffd611', 'ffb613', 'ff8b13',
  'ff500d', 'ff0000', 'de0101', 'a71001', '911003'
];
// Adjust min/max to the printed LST range.
Map.addLayer(lst, {min: 25, max: 37, palette: heatPalette}, 'LST (°C)');


// ===================== 5. Urban Heat Island (normalized) =====================
// UHI = (LST − mean LST) / standard deviation of LST
var uhi = lst.subtract(lstMean).divide(lstStd).rename('UHI');

Map.addLayer(uhi, {
  min: -2.5, max: 2.5,
  palette: ['1f77b4', 'a6cee3', '31a354', 'f1e2a2', 'ff7f0e', 'd62728', '8c2d04']
}, 'UHI (normalized)');


// ===================== 6. Urban Thermal Field Variance Index =====================
// UTFVI = (LST − mean LST) / LST, computed in Kelvin so the standard
// ecological thresholds (0, 0.005, 0.010, 0.015, 0.020) apply.
var lstMeanK = regionStat(lstK, ee.Reducer.mean());
var utfvi = lstK.subtract(lstMeanK).divide(lstK).rename('UTFVI');

// Ecological evaluation classes:
// 1 Excellent (<0), 2 Good (0–0.005), 3 Normal (0.005–0.010),
// 4 Bad (0.010–0.015), 5 Worse (0.015–0.020), 6 Worst (>0.020)
var utfviClass = ee.Image(1)
    .where(utfvi.gte(0),     2)
    .where(utfvi.gte(0.005), 3)
    .where(utfvi.gte(0.010), 4)
    .where(utfvi.gte(0.015), 5)
    .where(utfvi.gte(0.020), 6)
    .updateMask(utfvi.mask())
    .clip(aoi)
    .rename('UTFVI_class')
    .toByte();

Map.addLayer(utfvi, {min: -0.03, max: 0.03,
  palette: ['f0f8ff', 'a1c9d9', '64a6a6', 'ffffb2', 'ffcc66', 'ff4400', 'ff0000', '6600cc']},
  'UTFVI', false);
Map.addLayer(utfviClass, {min: 1, max: 6,
  palette: ['1a9850', '91cf60', 'd9ef8b', 'fee08b', 'fc8d59', 'd73027']},
  'UTFVI ecological classes');

// Area and share of KCC in each UTFVI class
var classNames = ee.List(['Excellent', 'Good', 'Normal', 'Bad', 'Worse', 'Worst']);
var classAreas = ee.List(ee.Image.pixelArea().divide(1e6).addBands(utfviClass)
    .reduceRegion({
      reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'class'}),
      geometry: aoi,
      scale: SCALE,
      maxPixels: 1e9
    }).get('groups'));

var totalArea = ee.Number(classAreas.map(function (g) {
  return ee.Dictionary(g).get('sum');
}).reduce(ee.Reducer.sum()));

var classSummary = classAreas.map(function (g) {
  g = ee.Dictionary(g);
  var area = ee.Number(g.get('sum'));
  return ee.Dictionary({
    class: classNames.get(ee.Number(g.get('class')).subtract(1)),
    area_km2: area,
    percent: area.divide(totalArea).multiply(100)
  });
});
print('UTFVI class areas:', classSummary);


// ===================== 7. NDVI and green space =====================
var ndvi = image.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI');
Map.addLayer(ndvi, {min: -0.15, max: 0.72, palette: ['e5f5e0', 'a1d99b', '31a354']},
             'NDVI', false);

// Pearson correlation between NDVI and LST across all KCC pixels
var ndviLstCorr = ndvi.addBands(lst).reduceRegion({
  reducer: ee.Reducer.pearsonsCorrelation(),
  geometry: aoi,
  scale: SCALE,
  maxPixels: 1e9
});
print('NDVI vs LST (Pearson correlation and p-value):', ndviLstCorr);


// ===================== 8. Export GeoTIFFs to Google Drive =====================
// Run each task from the Tasks tab (top right).
function exportTif(img, name) {
  Export.image.toDrive({
    image: img,
    description: name,
    fileNamePrefix: name,
    folder: 'KCC_UHI',
    region: aoi.geometry(),
    scale: SCALE,
    crs: EXPORT_CRS,
    maxPixels: 1e9
  });
}

exportTif(lst.toFloat(),   'lst_kcc_2024');
exportTif(uhi.toFloat(),   'uhi_kcc_2024');
exportTif(utfvi.toFloat(), 'utfvi_kcc_2024');
exportTif(utfviClass,      'utfvi_class_kcc_2024');
exportTif(ndvi.toFloat(),  'ndvi_kcc_2024');