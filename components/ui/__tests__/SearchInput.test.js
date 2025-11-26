import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SearchInput from '../SearchInput';
import { Provider as PaperProvider } from 'react-native-paper';

const renderWithTheme = (component) => {
    return render(
        <PaperProvider>
            {component}
        </PaperProvider>
    );
};

describe('SearchInput', () => {
    it('renders correctly', () => {
        const { getByPlaceholderText } = renderWithTheme(<SearchInput placeholder="Search..." />);
        expect(getByPlaceholderText('Search...')).toBeTruthy();
    });

    it('handles text input', () => {
        const onChangeText = jest.fn();
        const { getByPlaceholderText } = renderWithTheme(
            <SearchInput placeholder="Search..." onChangeText={onChangeText} value="" />
        );
        const input = getByPlaceholderText('Search...');
        fireEvent.changeText(input, 'test query');
        expect(onChangeText).toHaveBeenCalledWith('test query');
    });

    it('renders right prop content', () => {
        const { getByText } = renderWithTheme(
            <SearchInput placeholder="Search..." right={<Text>Right Content</Text>} />
        );
        expect(getByText('Right Content')).toBeTruthy();
    });

    it('shows clear button when there is text', () => {
        const onChangeText = jest.fn();
        const { getByTestId } = renderWithTheme(
            <SearchInput placeholder="Search..." value="test" onChangeText={onChangeText} />
        );
        expect(getByTestId('clear-button')).toBeTruthy();
    });

    it('calls onClear when clear button is pressed', () => {
        const onChangeText = jest.fn();
        const onClear = jest.fn();
        const { getByTestId } = renderWithTheme(
            <SearchInput placeholder="Search..." value="test" onChangeText={onChangeText} onClear={onClear} />
        );
        fireEvent.press(getByTestId('clear-button'));
        expect(onChangeText).toHaveBeenCalledWith('');
        expect(onClear).toHaveBeenCalled();
    });
});
