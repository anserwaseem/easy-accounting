import { store } from '../../store';
import { getCharts } from '../Chart.service';
import { connect } from '../Database.service';

jest.mock('../Database.service');
jest.mock('../../store');

describe('Chart Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return an array of charts', () => {
    const expectedCharts = [
      {
        id: 1,
        name: 'Cash',
        type: 'Asset',
        date: '2024-02-28',
        createdAt: '2024-03-02',
        updatedAt: '2024-03-02',
      },
      {
        id: 2,
        name: 'Current Liability',
        type: 'Liability',
        date: '2024-02-28',
        createdAt: '2024-03-02',
        updatedAt: '2024-03-02',
      },
    ];
    const mockAll = jest.fn().mockReturnValue(expectedCharts);
    const mockPrepare = jest.fn().mockReturnValue({ all: mockAll });
    (connect as jest.Mock).mockReturnValue({ prepare: mockPrepare });
    (store.get as jest.Mock).mockReturnValue('testUser');

    const charts = getCharts();

    expect(store.get).toHaveBeenCalledWith('username');
    expect(mockAll).toHaveBeenCalledWith({ username: 'testUser' });
    expect(charts).toEqual(expectedCharts);
  });
});
