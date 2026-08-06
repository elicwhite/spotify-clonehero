/**
 * @jest-environment jsdom
 */
/**
 * The tempo lane's BPM entry field: seeding, focus, Enter, and the bounds a
 * bad value runs into.
 */

import '@testing-library/jest-dom';
import {act, fireEvent, render, screen} from '@testing-library/react';
import BpmValuePopover from '../BpmValuePopover';

function mount(overrides: Partial<Parameters<typeof BpmValuePopover>[0]> = {}) {
  const onCommit = jest.fn();
  const onCancel = jest.fn();
  const view = render(
    <BpmValuePopover
      initialBpm={140}
      anchorLabel="9.1"
      onCommit={onCommit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return {onCommit, onCancel, ...view};
}

const field = () => screen.getByLabelText('BPM') as HTMLInputElement;

function typeBpm(text: string) {
  fireEvent.change(field(), {target: {value: text}});
}

describe('BpmValuePopover', () => {
  it('seeds the field with the current BPM and focuses it', () => {
    mount();
    expect(field()).toHaveValue('140.0');
    expect(field()).toHaveFocus();
  });

  it('reads as setting an existing marker, not adding one', () => {
    mount();
    expect(screen.getByText('Set tempo')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Set'})).toBeInTheDocument();
  });

  it('commits the typed value on Enter, decimal intact', () => {
    const {onCommit} = mount();
    typeBpm('148.6');
    fireEvent.keyDown(field(), {key: 'Enter'});
    expect(onCommit).toHaveBeenCalledWith(148.6);
  });

  it('commits the typed value from the button', () => {
    const {onCommit} = mount();
    typeBpm('93.25');
    act(() => {
      screen.getByRole('button', {name: 'Set'}).click();
    });
    expect(onCommit).toHaveBeenCalledWith(93.25);
  });

  it('refuses a zero, a negative and an absurd tempo', () => {
    const {onCommit} = mount();
    for (const bad of ['0', '-4', '5000', 'fast']) {
      typeBpm(bad);
      expect(screen.getByRole('button', {name: 'Set'})).toBeDisabled();
      fireEvent.keyDown(field(), {key: 'Enter'});
    }
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('clears the error once the value is typeable again', () => {
    const {onCommit} = mount();
    typeBpm('0');
    fireEvent.keyDown(field(), {key: 'Enter'});
    expect(screen.getByRole('alert')).toBeInTheDocument();

    typeBpm('180');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.keyDown(field(), {key: 'Enter'});
    expect(onCommit).toHaveBeenCalledWith(180);
  });

  it('cancels without committing', () => {
    const {onCommit, onCancel} = mount();
    typeBpm('200');
    act(() => {
      screen.getByRole('button', {name: 'Cancel'}).click();
    });
    expect(onCancel).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
