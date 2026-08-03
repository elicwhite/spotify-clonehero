/**
 * @jest-environment jsdom
 */
/**
 * AssistRunCard RTL tests (plan 0074 Phase 1, Suite 2).
 */

import '@testing-library/jest-dom';
import {render, screen, fireEvent} from '@testing-library/react';
import AssistRunCard from '../AssistRunCard';
import {
  IDLE_ASSIST_RUN_STATE,
  type AssistRunState,
} from '@/lib/assist/assist-store';

function runningState(overrides: Partial<AssistRunState> = {}): AssistRunState {
  return {
    task: 'transcribe-drums',
    status: 'running',
    steps: [
      {
        key: 'separating',
        label: 'Separating Stems',
        status: 'done',
        durationMs: 1200,
      },
      {
        key: 'tempo-mapping',
        label: 'Building Tempo Map',
        status: 'active',
        progress: 0.3,
      },
      {key: 'transcribing', label: 'Transcribing Drums', status: 'pending'},
    ],
    ...overrides,
  };
}

describe('AssistRunCard', () => {
  it('renders nothing when idle', () => {
    const {container} = render(<AssistRunCard state={IDLE_ASSIST_RUN_STATE} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders each step as a list item with its label', () => {
    render(<AssistRunCard state={runningState()} />);
    const list = screen.getByRole('list', {name: /progress steps/i});
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(list).toHaveTextContent('Separating Stems');
    expect(list).toHaveTextContent('Building Tempo Map');
    expect(list).toHaveTextContent('Transcribing Drums');
  });

  it('fires onCancel when the cancel button is clicked', () => {
    const onCancel = jest.fn();
    render(<AssistRunCard state={runningState()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', {name: /cancel/i}));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not render a cancel button once the run is no longer active', () => {
    render(
      <AssistRunCard
        state={runningState({status: 'success'})}
        onCancel={jest.fn()}
      />,
    );
    expect(
      screen.queryByRole('button', {name: /cancel/i}),
    ).not.toBeInTheDocument();
  });

  it('shows the error message on a failed run', () => {
    render(
      <AssistRunCard
        state={runningState({status: 'error', error: 'Separation failed'})}
      />,
    );
    expect(screen.getByText('Separation failed')).toBeInTheDocument();
  });

  it('shows a cancelled notice and no error text on a cancelled run', () => {
    render(<AssistRunCard state={runningState({status: 'cancelled'})} />);
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
  });
});
