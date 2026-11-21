import { Background, Controls, ReactFlow, type Node } from '@xyflow/react';

const nodes: Node[] = [
  {
    id: 'checkout',
    type: 'group',
    position: { x: 0, y: 0 },
    data: { label: 'checkout' },
    style: { width: 800, height: 500 },
  },
];

export function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow nodes={nodes} edges={[]} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
