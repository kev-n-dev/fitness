import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Center } from '@react-three/drei'
import * as THREE from 'three'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

/**
 * Parametric body mesh generator.
 * Creates a simplified human body shape that responds to measurement parameters.
 * 
 * This is a pure Three.js implementation for the case where OxiHuman WASM
 * is not available. When oxihuman-wasm is installed and the asset pack is present,
 * this component will use OxiHuman's more accurate parametric morphing.
 */

// Default body proportions (in relative units)
const BASE_PROPORTIONS = {
  headRadius: 0.12,
  neckHeight: 0.06,
  neckRadius: 0.045,
  shoulderWidth: 0.22,
  torsoHeight: 0.32,
  chestRadius: 0.11,
  waistRadius: 0.085,
  hipRadius: 0.1,
  hipHeight: 0.08,
  upperArmLength: 0.16,
  upperArmRadius: 0.035,
  forearmLength: 0.14,
  forearmRadius: 0.028,
  thighLength: 0.24,
  thighRadius: 0.055,
  calfLength: 0.22,
  calfRadius: 0.038,
}

// Map real measurements (cm) to scale factors
function measurementsToScaleFactors(measurements) {
  // Default reference values (average adult male)
  const defaults = {
    height: 175,
    chest: 100,
    waist: 85,
    hips: 100,
    shoulders: 115,
    neck: 38,
    upperArmLeft: 32,
    upperArmRight: 32,
    forearmLeft: 28,
    forearmRight: 28,
    thighLeft: 55,
    thighRight: 55,
    calfLeft: 38,
    calfRight: 38,
  }
  
  const getScale = (key, defaultVal) => {
    const val = measurements[key]
    if (val == null || val <= 0) return 1
    return val / defaultVal
  }
  
  return {
    height: getScale('height', defaults.height),
    chest: getScale('chest', defaults.chest),
    waist: getScale('waist', defaults.waist),
    hips: getScale('hips', defaults.hips),
    shoulders: getScale('shoulders', defaults.shoulders),
    neck: getScale('neck', defaults.neck),
    upperArmLeft: getScale('upperArmLeft', defaults.upperArmLeft),
    upperArmRight: getScale('upperArmRight', defaults.upperArmRight),
    forearmLeft: getScale('forearmLeft', defaults.forearmLeft),
    forearmRight: getScale('forearmRight', defaults.forearmRight),
    thighLeft: getScale('thighLeft', defaults.thighLeft),
    thighRight: getScale('thighRight', defaults.thighRight),
    calfLeft: getScale('calfLeft', defaults.calfLeft),
    calfRight: getScale('calfRight', defaults.calfRight),
  }
}

// Create a capsule-like shape
function createCapsuleGeometry(radius, height, segments = 16) {
  const geometry = new THREE.CapsuleGeometry(radius, height, 4, segments)
  return geometry
}

// Create torso using lathe geometry for more organic shape
function createTorsoGeometry(chestRadius, waistRadius, hipRadius, height) {
  const points = []
  const segments = 20
  
  // Build profile curve from bottom (hips) to top (chest)
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    
    // Spine curve (subtle S-curve)
    let radius
    if (t < 0.25) {
      // Hips region
      radius = THREE.MathUtils.lerp(hipRadius, waistRadius * 0.95, t * 4)
    } else if (t < 0.5) {
      // Waist region
      const localT = (t - 0.25) * 4
      radius = THREE.MathUtils.lerp(waistRadius * 0.95, waistRadius, localT)
    } else if (t < 0.75) {
      // Lower chest
      const localT = (t - 0.5) * 4
      radius = THREE.MathUtils.lerp(waistRadius, chestRadius, localT)
    } else {
      // Upper chest
      const localT = (t - 0.75) * 4
      radius = THREE.MathUtils.lerp(chestRadius, chestRadius * 0.9, localT)
    }
    
    const y = (t - 0.5) * height
    points.push(new THREE.Vector2(radius, y))
  }
  
  const geometry = new THREE.LatheGeometry(points, 32)
  return geometry
}

/**
 * Parametric body component
 */
function ParametricBody({ scales, color = '#e8d4c4' }) {
  const groupRef = useRef()
  
  // Calculate adjusted proportions based on measurement scales
  const props = useMemo(() => {
    const p = { ...BASE_PROPORTIONS }
    
    // Scale overall height
    const heightScale = scales.height
    
    // Scale torso dimensions
    const chestScale = Math.sqrt(scales.chest)
    const waistScale = Math.sqrt(scales.waist)
    const hipScale = Math.sqrt(scales.hips)
    const shoulderScale = scales.shoulders / scales.chest // Relative to chest
    
    return {
      ...p,
      heightScale,
      chestRadius: p.chestRadius * chestScale,
      waistRadius: p.waistRadius * waistScale,
      hipRadius: p.hipRadius * hipScale,
      shoulderWidth: p.shoulderWidth * shoulderScale * chestScale,
      neckRadius: p.neckRadius * Math.sqrt(scales.neck),
      upperArmRadiusL: p.upperArmRadius * Math.sqrt(scales.upperArmLeft),
      upperArmRadiusR: p.upperArmRadius * Math.sqrt(scales.upperArmRight),
      forearmRadiusL: p.forearmRadius * Math.sqrt(scales.forearmLeft),
      forearmRadiusR: p.forearmRadius * Math.sqrt(scales.forearmRight),
      thighRadiusL: p.thighRadius * Math.sqrt(scales.thighLeft),
      thighRadiusR: p.thighRadius * Math.sqrt(scales.thighRight),
      calfRadiusL: p.calfRadius * Math.sqrt(scales.calfLeft),
      calfRadiusR: p.calfRadius * Math.sqrt(scales.calfRight),
    }
  }, [scales])
  
  const material = useMemo(() => (
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.1,
      flatShading: false,
    })
  ), [color])
  
  // Torso
  const torsoGeometry = useMemo(() => 
    createTorsoGeometry(props.chestRadius, props.waistRadius, props.hipRadius, props.torsoHeight * props.heightScale),
    [props]
  )
  
  // Head
  const headGeometry = useMemo(() => 
    new THREE.SphereGeometry(props.headRadius * props.heightScale, 24, 24),
    [props]
  )
  
  // Neck
  const neckGeometry = useMemo(() => 
    createCapsuleGeometry(props.neckRadius, props.neckHeight * props.heightScale),
    [props]
  )
  
  // Arms
  const upperArmGeomL = useMemo(() => 
    createCapsuleGeometry(props.upperArmRadiusL, props.upperArmLength * props.heightScale),
    [props]
  )
  const upperArmGeomR = useMemo(() => 
    createCapsuleGeometry(props.upperArmRadiusR, props.upperArmLength * props.heightScale),
    [props]
  )
  const forearmGeomL = useMemo(() => 
    createCapsuleGeometry(props.forearmRadiusL, props.forearmLength * props.heightScale),
    [props]
  )
  const forearmGeomR = useMemo(() => 
    createCapsuleGeometry(props.forearmRadiusR, props.forearmLength * props.heightScale),
    [props]
  )
  
  // Legs
  const thighGeomL = useMemo(() => 
    createCapsuleGeometry(props.thighRadiusL, props.thighLength * props.heightScale),
    [props]
  )
  const thighGeomR = useMemo(() => 
    createCapsuleGeometry(props.thighRadiusR, props.thighLength * props.heightScale),
    [props]
  )
  const calfGeomL = useMemo(() => 
    createCapsuleGeometry(props.calfRadiusL, props.calfLength * props.heightScale),
    [props]
  )
  const calfGeomR = useMemo(() => 
    createCapsuleGeometry(props.calfRadiusR, props.calfLength * props.heightScale),
    [props]
  )
  
  // Position calculations
  const hs = props.heightScale
  const torsoTop = props.torsoHeight * hs / 2
  const torsoBottom = -props.torsoHeight * hs / 2
  const neckY = torsoTop + props.neckHeight * hs / 2
  const headY = neckY + props.neckHeight * hs / 2 + props.headRadius * hs
  const shoulderY = torsoTop - 0.03 * hs
  const shoulderX = props.shoulderWidth / 2
  const upperArmY = shoulderY - props.upperArmLength * hs / 2 - 0.01
  const forearmY = upperArmY - props.upperArmLength * hs / 2 - props.forearmLength * hs / 2 - 0.01
  const hipY = torsoBottom - props.hipHeight * hs / 2
  const thighY = hipY - props.thighLength * hs / 2
  const hipX = props.hipRadius * 0.5
  const calfY = thighY - props.thighLength * hs / 2 - props.calfLength * hs / 2 - 0.01
  
  return (
    <group ref={groupRef}>
      {/* Torso */}
      <mesh geometry={torsoGeometry} material={material} />
      
      {/* Neck */}
      <mesh geometry={neckGeometry} material={material} position={[0, neckY, 0]} />
      
      {/* Head */}
      <mesh geometry={headGeometry} material={material} position={[0, headY, 0]} />
      
      {/* Left arm */}
      <mesh geometry={upperArmGeomL} material={material} position={[-shoulderX, upperArmY, 0]} />
      <mesh geometry={forearmGeomL} material={material} position={[-shoulderX, forearmY, 0]} />
      
      {/* Right arm */}
      <mesh geometry={upperArmGeomR} material={material} position={[shoulderX, upperArmY, 0]} />
      <mesh geometry={forearmGeomR} material={material} position={[shoulderX, forearmY, 0]} />
      
      {/* Left leg */}
      <mesh geometry={thighGeomL} material={material} position={[-hipX, thighY, 0]} />
      <mesh geometry={calfGeomL} material={material} position={[-hipX, calfY, 0]} />
      
      {/* Right leg */}
      <mesh geometry={thighGeomR} material={material} position={[hipX, thighY, 0]} />
      <mesh geometry={calfGeomR} material={material} position={[hipX, calfY, 0]} />
    </group>
  )
}

/**
 * Scene setup with lighting and camera
 */
function Scene({ scales, onReady }) {
  const called = useRef(false)
  
  useEffect(() => {
    if (!called.current && onReady) {
      called.current = true
      // Delay slightly to ensure render
      requestAnimationFrame(() => onReady())
    }
  }, [onReady])
  
  return (
    <>
      {/* Ambient light for overall illumination */}
      <ambientLight intensity={0.5} />
      
      {/* Key light from front-right */}
      <directionalLight
        position={[5, 5, 5]}
        intensity={0.8}
      />
      
      {/* Fill light from left */}
      <directionalLight
        position={[-3, 3, 2]}
        intensity={0.4}
      />
      
      {/* Rim light from behind */}
      <directionalLight
        position={[0, 2, -5]}
        intensity={0.3}
      />
      
      {/* The parametric body */}
      <Center>
        <ParametricBody scales={scales} />
      </Center>
      
      {/* Orbit controls for rotation/zoom/pan */}
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={0.5}
        maxDistance={3}
        target={[0, 0, 0]}
        autoRotate={false}
      />
    </>
  )
}

/**
 * Loading placeholder while 3D assets load
 */
function LoadingPlaceholder({ error }) {
  return (
    <div className="body-3d-loading">
      {error ? (
        <>
          <Icon name="xmark" className="body-3d-error-icon" />
          <span className="body-3d-error-text">{error}</span>
        </>
      ) : (
        <>
          <div className="body-3d-spinner" />
          <span>{t('Loading 3D model...')}</span>
        </>
      )}
    </div>
  )
}

/**
 * Check for WebGL support
 */
function hasWebGLSupport() {
  try {
    const canvas = document.createElement('canvas')
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    )
  } catch {
    return false
  }
}

/**
 * Main 3D body visualizer component.
 * Uses parametric Three.js body with measurement-based morphing.
 * 
 * Future: When oxihuman-wasm is available via npm, this component
 * will optionally use OxiHuman's WASM-based parametric body generator
 * for more accurate and detailed body representation.
 */
export default function BodyVisualizer3D({ measurements = {}, onReady }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const containerRef = useRef(null)
  
  // Check WebGL support on mount
  useEffect(() => {
    if (!hasWebGLSupport()) {
      setError(t('WebGL not supported'))
      setLoading(false)
      return
    }
    
    // Short delay to ensure React Three Fiber initializes
    const timer = setTimeout(() => {
      setLoading(false)
    }, 100)
    
    return () => clearTimeout(timer)
  }, [])
  
  // Calculate scale factors from measurements
  const scales = useMemo(() => 
    measurementsToScaleFactors(measurements),
    [measurements]
  )
  
  const handleReady = useCallback(() => {
    if (onReady) onReady()
  }, [onReady])
  
  if (loading) {
    return <LoadingPlaceholder />
  }
  
  if (error) {
    return <LoadingPlaceholder error={error} />
  }
  
  return (
    <div ref={containerRef} className="body-3d-container">
      <Canvas
        camera={{ position: [0, 0, 1.2], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <Scene scales={scales} onReady={handleReady} />
      </Canvas>
      
      {/* Controls hint */}
      <div className="body-3d-controls-hint">
        <Icon name="hand" />
        <span>{t('Drag to rotate')}</span>
      </div>
    </div>
  )
}
