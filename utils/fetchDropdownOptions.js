// fetchDropdownOptions.js - Fetches dropdown options and available asset IDs from the API

/**
 * Fetches dropdown data and available asset IDs from the backend API.
 * @returns {Promise<Object>} Dropdown data and available asset IDs.
 */
export async function fetchDropdownOptions() {
  try {
    // Fetch dropdown options and assets in parallel
    const [dropdownRes, assetsRes] = await Promise.all([
      fetch('http://ec2-13-238-161-9.ap-southeast-2.compute.amazonaws.com:3000/assets/asset-options'),
      fetch('http://ec2-13-238-161-9.ap-southeast-2.compute.amazonaws.com:3000/assets'),
    ]);

    // Parse JSON responses
    const dropdownData = await dropdownRes.json();
    const assets = await assetsRes.json();

    // Filter assets to find placeholder IDs (unassigned, available, no type/model/serial)
    const placeholderIds = assets
      .filter(a =>
        a.assigned_to_id === null &&
        a.status?.toLowerCase() === 'available' &&
        !a.type_id &&
        !a.model &&
        !a.serial_number
      )
      .map(a => ({ id: a.id }));

    // Return combined dropdown data and asset IDs
    return {
      ...dropdownData,
      assetIds: placeholderIds,
    };
  } catch (error) {
    // Log error and return empty fallback structure
    console.error('❌ Error fetching dropdown options:', error);
    return { assetTypes: [], models: [], users: [], statuses: [], assetIds: [] };
  }
}
