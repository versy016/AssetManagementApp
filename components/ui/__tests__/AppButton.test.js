import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import AppButton from '../AppButton';
import { Provider as PaperProvider } from 'react-native-paper';
import { theme } from '../../../constants/uiTheme';

const renderWithTheme = (component) => {
    return render(
        <PaperProvider theme={theme}>
            {component}
        </PaperProvider>
    );
};

describe('AppButton', () => {
    it('renders correctly with label', () => {
        const { getByText } = renderWithTheme(<AppButton>Click Me</AppButton>);
        expect(getByText('Click Me')).toBeTruthy();
    });

    it('calls onPress when clicked', () => {
        const onPressMock = jest.fn();
        const { getByText } = renderWithTheme(<AppButton onPress={onPressMock}>Click Me</AppButton>);

        fireEvent.press(getByText('Click Me'));
        expect(onPressMock).toHaveBeenCalledTimes(1);
    });

    it('shows loading indicator when loading prop is true', () => {
        const { getByRole } = renderWithTheme(<AppButton loading>Click Me</AppButton>);
        // React Native Paper Button renders an ActivityIndicator when loading is true
        // We can check if the button is disabled as well, which it should be
        const button = getByRole('button');
        expect(button.props.accessibilityState.disabled).toBe(true);
    });
});
