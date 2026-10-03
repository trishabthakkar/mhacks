import * as THREE from 'three';
import { makeFakeSnapshots } from '../../shared/fake-data.ts';

// Proves both three and ../shared resolve. P4 replaces this with the real scene.
const last = makeFakeSnapshots(10).at(-1)!;
const info = document.getElementById('info');
if (info) info.textContent = `three r${THREE.REVISION}, ${last.plants.length} fake plants, ${last.members.length} fake members`;
