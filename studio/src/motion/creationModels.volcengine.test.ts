import { expect, it } from 'vitest';
import type { Model } from '../../../shared/gateway';
import { creationModels } from './creationModels';
import { studioScenes } from './creativeStudios';
import { menuRank } from './imageMenuModels';

const video = (modelId: string, label: string, menu?: boolean): Model => ({
  id: `opendesign:${modelId}`, provider: 'opendesign', modelId, label, modality: 'video', mode: 'text-to-video',
  source: 'builtin', maxInputImages: 1, ...(menu ? { menu } : {}),
});

it('lists operator-configured backend models in Studio menus after the built-in set', () => {
  const seedance25 = video('doubao-seedance-2-5-260628', 'Seedance 2.5', true);
  const seedance20 = video('doubao-seedance-2-0-260128', 'Seedance 2.0', true);
  const mini = video('doubao-seedance-2-0-mini-260615', 'Seedance 2.0 Mini', true);
  const unlisted = video('some-live-model', 'Some live model');
  expect(menuRank(seedance20)).toBeGreaterThan(menuRank(seedance25));
  expect(menuRank(unlisted)).toBe(-1);

  const scene = studioScenes.find(item => item.modality === 'video' && !('videoFeature' in item))!;
  const result = creationModels(
    { models: [seedance25, seedance20, mini, unlisted], status: { routes: {}, providers: [{ id: 'opendesign', label: 'Volcengine', available: true }] } } as never,
    'video', undefined, scene,
  );
  const ids = result.compatible.map(model => model.modelId);
  expect(ids).toEqual(expect.arrayContaining([seedance25.modelId, seedance20.modelId, mini.modelId]));
  expect(ids).not.toContain('some-live-model');
});
