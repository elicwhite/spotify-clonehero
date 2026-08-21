/**
 * @jest-environment jsdom
 */
/**
 * Recording which assist tasks a chart has been through (plan 0105 Stage 5).
 *
 * The case that matters most has nothing to do with analytics: this hook
 * writes to a project's metadata, so getting it wrong destroys a real field
 * on a real project. A finished run's status lingers in the shared runner
 * store for several seconds, and that store outlives the component that
 * opens a project — so the hook must react to a run REACHING success, never
 * to the runner sitting at it.
 *
 * These drive the runner store directly and never render between the
 * `running` and `success` writes: the hook must not depend on React having
 * rendered the intermediate state, because a task that settles in microtasks
 * can coalesce both into one render.
 */

import {act} from 'react';
import {renderHook} from '@testing-library/react';

import {AssistStore} from '@/lib/assist/assist-store';
import type {AssistTaskKey} from '@/lib/assist/tasks/types';
import type {AssistRunnerControls} from '@/components/assist/useAssistRunner';
import {useProjectToolsApplied} from '../hooks/useToolsApplied';

interface Meta {
  toolsApplied?: AssistTaskKey[] | undefined;
}

function harness(store: AssistStore, initial: Meta | null = {}) {
  const updateProject = jest.fn(async () => ({}));
  const runner = {store} as unknown as AssistRunnerControls;
  let meta: Meta | null = initial;
  const setProjectMeta = jest.fn(
    (update: (prev: Meta | null) => Meta | null) => {
      meta = update(meta);
    },
  );
  const view = renderHook(
    (props: {projectId: string | null; meta: Meta | null}) => {
      meta = props.meta;
      return useProjectToolsApplied({
        runner,
        projectId: props.projectId,
        projectMeta: props.meta,
        setProjectMeta,
        updateProject,
      });
    },
    {
      initialProps: {
        projectId: 'project-a' as string | null,
        meta: initial,
      },
    },
  );
  return {updateProject, view, currentMeta: () => meta};
}

/** One run, start to finish, with no render in between. */
async function runTask(store: AssistStore, task: AssistTaskKey) {
  await act(async () => {
    store.setState({task, steps: [], status: 'running'});
    store.setState({task, steps: [], status: 'success'});
  });
}

test('a run that reaches success is recorded on the open project', async () => {
  const store = new AssistStore();
  const {updateProject} = harness(store);

  await runTask(store, 'generate-tempo-map');

  expect(updateProject).toHaveBeenCalledWith('project-a', {
    toolsApplied: ['generate-tempo-map'],
  });
});

test('a run whose start and finish land in one render is still recorded', async () => {
  // A task resolved from cache settles in microtasks, so a React-rendered
  // view of the status can never show `running`. Subscribing to the store is
  // what makes this observable at all.
  const store = new AssistStore();
  const {updateProject} = harness(store);

  await act(async () => {
    store.setState({task: 'add-lyrics', steps: [], status: 'running'});
    store.setState({task: 'add-lyrics', steps: [], status: 'success'});
  });

  expect(updateProject).toHaveBeenCalledWith('project-a', {
    toolsApplied: ['add-lyrics'],
  });
});

test('a run that finished under the previous project is not recorded on the next', async () => {
  // The user ran a task in project A, it finished, and within the seconds its
  // card stays on screen they opened project B. The editor is keyed by
  // project, so B gets a fresh hook — but the RUNNER lives above the editor
  // and is still sitting at `success`, and it goes on notifying as the
  // finished card updates itself. None of that may land on B.
  const store = new AssistStore();
  store.setState({task: 'add-lyrics', steps: [], status: 'success'});

  const {updateProject} = harness(store, {toolsApplied: ['generate-sections']});
  await act(async () => {
    // A notification that leaves the run AT success: not a new run, so not
    // an edge, so nothing may be recorded.
    store.setState({
      task: 'add-lyrics',
      steps: [{key: 'align', label: 'Aligning', status: 'done'}],
      status: 'success',
    });
  });

  expect(updateProject).not.toHaveBeenCalled();
});

test('a tool already recorded is not written again', async () => {
  const store = new AssistStore();
  const {updateProject} = harness(store, {toolsApplied: ['add-lyrics']});

  await runTask(store, 'add-lyrics');

  expect(updateProject).not.toHaveBeenCalled();
});

test('a second, different tool is appended to the first', async () => {
  // The second run finishes before React has re-rendered with the first
  // one's result, so the hook has to remember what it already wrote.
  const store = new AssistStore();
  const {updateProject} = harness(store);

  await runTask(store, 'generate-tempo-map');
  await runTask(store, 'add-lyrics');

  expect(updateProject).toHaveBeenLastCalledWith('project-a', {
    toolsApplied: ['generate-tempo-map', 'add-lyrics'],
  });
});

test('nothing is recorded before a project is open', async () => {
  const store = new AssistStore();
  const {updateProject, view} = harness(store);
  view.rerender({projectId: null, meta: null});

  await runTask(store, 'add-lyrics');

  expect(updateProject).not.toHaveBeenCalled();
});

test('a cancelled or failed run records nothing', async () => {
  const store = new AssistStore();
  const {updateProject} = harness(store);

  await act(async () => {
    store.setState({task: 'add-lyrics', steps: [], status: 'running'});
    store.setState({task: 'add-lyrics', steps: [], status: 'cancelled'});
  });
  await act(async () => {
    store.setState({task: 'add-lyrics', steps: [], status: 'running'});
    store.setState({task: 'add-lyrics', steps: [], status: 'error'});
  });

  expect(updateProject).not.toHaveBeenCalled();
});

test('a failed write leaves the project record untouched and does not throw', async () => {
  const store = new AssistStore();
  const {updateProject, currentMeta} = harness(store);
  updateProject.mockRejectedValueOnce(new Error('quota exceeded'));
  jest.spyOn(console, 'warn').mockImplementation(() => {});

  await runTask(store, 'add-lyrics');
  await act(async () => {});

  expect(currentMeta()?.toolsApplied).toBeUndefined();
});

test('a write that failed is retried by the next successful run', async () => {
  // The hook remembers what it wrote so two quick runs do not overwrite each
  // other. A write that did NOT land must be forgotten, or that memory
  // suppresses every retry and the field stays permanently short.
  const store = new AssistStore();
  const {updateProject} = harness(store);
  updateProject.mockRejectedValueOnce(new Error('quota exceeded'));
  jest.spyOn(console, 'warn').mockImplementation(() => {});

  await runTask(store, 'add-lyrics');
  await act(async () => {});
  await runTask(store, 'add-lyrics');

  expect(updateProject).toHaveBeenCalledTimes(2);
});

test('a run inherited from the project the user left is not recorded here', async () => {
  // The runner outlives the editor and nothing cancels a run when the editor
  // unmounts. So: start a long run on project A, go back, open project B.
  // This hook mounts watching A's run. Its success belongs to A.
  const store = new AssistStore();
  store.setState({task: 'add-lyrics', steps: [], status: 'running'});

  const {updateProject} = harness(store);
  await act(async () => {
    store.setState({task: 'add-lyrics', steps: [], status: 'success'});
  });

  expect(updateProject).not.toHaveBeenCalled();
});

test('a real run after an inherited one is still recorded', async () => {
  // The inherited run has to be forgotten once it ends, whatever it ends as
  // — otherwise it suppresses every genuine run for the rest of the session.
  const store = new AssistStore();
  store.setState({task: 'add-lyrics', steps: [], status: 'running'});

  const {updateProject} = harness(store);
  await act(async () => {
    store.setState({task: 'add-lyrics', steps: [], status: 'cancelled'});
  });
  await runTask(store, 'generate-tempo-map');

  expect(updateProject).toHaveBeenCalledWith('project-a', {
    toolsApplied: ['generate-tempo-map'],
  });
});
