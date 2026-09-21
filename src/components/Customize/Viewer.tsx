import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Center } from "@react-three/drei";
import type { BufferGeometry } from "three";

const SLOW_RENDER_HINT_DELAY_MS = 8000;

interface ViewerProps {
  geometry: BufferGeometry | null;
  loading: boolean;
  error: string | null;
  color: string;
  /** From estimateComplexity/complexityMessage — swaps in once a render runs long. */
  complexityMessage?: string | null;
  /** Admin Panel thumbnail capture needs the raw canvas element; unused by the public Customize view. */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

export function Viewer({
  geometry,
  loading,
  error,
  color,
  complexityMessage,
  onCanvasReady,
}: ViewerProps) {
  const [showComplexityHint, setShowComplexityHint] = useState(false);

  useEffect(() => {
    if (!loading) {
      setShowComplexityHint(false);
      return;
    }
    const timer = setTimeout(() => setShowComplexityHint(true), SLOW_RENDER_HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  const loadingMessage =
    showComplexityHint && complexityMessage ? complexityMessage : "Rendering…";

  return (
    <div className="viewer">
      <Canvas
        camera={{ position: [120, 100, 140], fov: 40 }}
        gl={{ preserveDrawingBuffer: true }}
        onCreated={(state) => onCanvasReady?.(state.gl.domElement)}
      >
        <color attach="background" args={["#f4f4f5"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[100, 150, 100]} intensity={1} />
        <directionalLight position={[-100, 50, -100]} intensity={0.3} />
        {/* STL/OpenSCAD geometry is Z-up; rotate into Three's Y-up world. */}
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <Center>{geometry && <MeshView geometry={geometry} color={color} />}</Center>
        </group>
        <Grid
          args={[300, 300]}
          position={[0, -0.01, 0]}
          cellColor="#d4d4d8"
          sectionColor="#a1a1aa"
          fadeDistance={400}
        />
        <OrbitControls makeDefault />
      </Canvas>
      {loading && <div className="viewer-overlay viewer-loading">{loadingMessage}</div>}
      {!loading && error && (
        <div className="viewer-overlay viewer-error">
          Couldn't render with these settings — showing the last working version.
        </div>
      )}
    </div>
  );
}

function MeshView({ geometry, color }: { geometry: BufferGeometry; color: string }) {
  const prepared = useMemo(() => {
    geometry.computeVertexNormals();
    return geometry;
  }, [geometry]);

  useEffect(() => () => prepared.dispose(), [prepared]);

  return (
    <mesh geometry={prepared} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.05} />
    </mesh>
  );
}
