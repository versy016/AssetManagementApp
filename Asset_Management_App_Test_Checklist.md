# Asset Management App - Test Checklist

**Generated:** $(date)

---

## Table of Contents

1. [Authentication & User Management](#1-authentication--user-management)
2. [Dashboard](#2-dashboard)
3. [Search & Inventory](#3-search--inventory)
4. [Asset Management](#4-asset-management)
5. [Asset Types](#5-asset-types)
6. [Certificates/Documents](#6-certificatesdocuments)
7. [Activity Log](#7-activity-log)
8. [QR Code Features](#8-qr-code-features)
9. [Quick Actions & Shortcuts](#9-quick-actions--shortcuts)
10. [Admin Features](#10-admin-features)
11. [Profile & Settings](#11-profile--settings)
12. [Mobile-Specific Features](#12-mobile-specific-features)
13. [Web-Specific Features](#13-web-specific-features)
14. [Performance & Error Handling](#14-performance--error-handling)

---

## 1. Authentication & User Management

| Feature/Input | Test Steps | Working | Feedback/Issues |
|--------------|------------|---------|-----------------|
| Login Screen | 1. Open app<br>2. Enter valid email/password<br>3. Click Login<br>4. Verify redirect to dashboard | ☐ | |
| Login - Invalid Credentials | 1. Enter wrong email/password<br>2. Verify error message<br>3. Verify no redirect | ☐ | |
| Login - Empty Fields | 1. Leave fields empty<br>2. Click Login<br>3. Verify validation message | ☐ | |
| Registration | 1. Navigate to Register<br>2. Fill all required fields<br>3. Submit<br>4. Verify account creation | ☐ | |
| Forgot Password | 1. Click "Forgot Password"<br>2. Enter email<br>3. Verify reset email sent | ☐ | |
| Logout | 1. Click Logout button<br>2. Verify redirect to login<br>3. Verify session cleared | ☐ | |
| Session Persistence | 1. Login<br>2. Close app<br>3. Reopen app<br>4. Verify still logged in | ☐ | |
| Auto-logout on Token Expiry | 1. Login<br>2. Wait for token expiry<br>3. Perform action<br>4. Verify redirect to login | ☐ | |

---

## 2. Dashboard

| Feature/Input | Test Steps | Working | Feedback/Issues |
|--------------|------------|---------|-----------------|
| Dashboard Load | 1. Login<br>2. Verify dashboard displays<br>3. Check all sections visible | ☐ | |
| My Tasks Section | 1. View tasks list<br>2. Scroll through tasks<br>3. Verify task details display | ☐ | |
| Task Actions | 1. Click on a task<br>2. Verify action modal opens<br>3. Complete task<br>4. Verify task removed from list | ☐ | |
| Recent Assets | 1. Check recent assets section<br>2. Verify asset cards display<br>3. Click asset<br>4. Verify navigation to asset detail | ☐ | |
| Quick Actions - Search | 1. Click Search button<br>2. Verify navigation to search screen | ☐ | |
| Quick Actions - Certs | 1. Click Certs button<br>2. Verify navigation to certs screen | ☐ | |
| Quick Actions - Activity | 1. Click Activity button<br>2. Verify navigation to activity screen | ☐ | |
| Shortcuts Section | 1. View shortcuts grid<br>2. Verify custom shortcuts display<br>3. Click shortcut<br>4. Verify action executes | ☐ | |
| Add Shortcut | 1. Click "Add Shortcut"<br>2. Select shortcut type<br>3. Verify shortcut added<br>4. Verify appears in grid | ☐ | |
| Remove Shortcut | 1. Click "Manage Added"<br>2. Remove a shortcut<br>3. Verify removed from grid | ☐ | |
| Dashboard Navigation (Web) | 1. Click navbar links<br>2. Verify navigation works<br>3. Verify active state highlighting | ☐ | |

---

## 3. Search & Inventory

| Feature/Input | Test Steps | Working | Feedback/Issues |
|--------------|------------|---------|-----------------|
| Search Input | 1. Enter search query<br>2. Verify results filter<br>3. Verify real-time search | ☐ | |
| Quick Filters | 1. Click "My Assets"<br>2. Verify filtered results<br>3. Click "Needs Service"<br>4. Verify filtered results<br>5. Click "In Service"<br>6. Verify filtered results | ☐ | |
| QR Awaiting Filter | 1. Click "QR Awaiting"<br>2. Verify only UUID assets shown<br>3. Verify "QR awaiting" label | ☐ | |
| Advanced Filters | 1. Open Filters modal<br>2. Select asset types<br>3. Select status<br>4. Apply filters<br>5. Verify results | ☐ | |
| Clear Filters | 1. Apply filters<br>2. Click "Clear All"<br>3. Verify all filters reset | ☐ | |
| Sort Options | 1. Select sort option<br>2. Verify results sorted<br>3. Change sort order<br>4. Verify re-sorted | ☐ | |
| Grid View | 1. Click Grid view<br>2. Verify card layout<br>3. Verify cards display correctly | ☐ | |
| Table View | 1. Click Table view<br>2. Verify table layout<br>3. Verify all columns visible<br>4. Verify horizontal scroll works | ☐ | |
| Pagination | 1. Navigate through pages<br>2. Verify page numbers<br>3. Click "View All"<br>4. Verify all results shown | ☐ | |
| Asset ID Click | 1. Click Asset ID in table<br>2. Verify navigation to asset detail | ☐ | |
| Dynamic Columns | 1. Filter by asset type with custom fields<br>2. Verify dynamic columns appear<br>3. Verify values display correctly | ☐ | |
| Mobile Search Layout | 1. Open on mobile<br>2. Verify responsive layout<br>3. Verify cards display properly<br>4. Verify filters accessible | ☐ | |
| Table Column Widths | 1. Verify all columns visible without horizontal scroll<br>2. Verify headings fully visible<br>3. Verify proper spacing | ☐ | |
| Table Borders | 1. Verify borders display correctly<br>2. Verify alignment | ☐ | |

---

## 4. Asset Management

| Feature/Input | Test Steps | Working | Feedback/Issues |
|--------------|------------|---------|-----------------|
| Asset Detail View | 1. Navigate to asset<br>2. Verify all fields display<br>3. Verify images load<br>4. Verify documents list | ☐ | |
| Edit Asset | 1. Click Edit<br>2. Modify fields<br>3. Save<br>4. Verify changes saved<br>5. Verify updated in list | ☐ | |
| Create New Asset | 1. Click "Create New Asset"<br>2. Fill required fields<br>3. Add optional fields<br>4. Submit<br>5. Verify asset created | ☐ | |
| Asset Status Change | 1. Change asset status<br>2. Verify status updates<br>3. Verify activity logged | ☐ | |
| Assign Asset | 1. Assign asset to user<br>2. Verify assignment saved<br>3. Verify appears in user's assets | ☐ | |
| Asset Images | 1. Upload image<br>2. Verify image displays<br>3. Verify thumbnail in list | ☐ | |
| Asset Documents | 1. Upload document<br>2. Verify document appears<br>3. Click "View"<br>4. Verify document opens | ☐ | |
| Additional Fields | 1. View additional fields<br>2. Verify custom fields display<br>3. Edit custom field values<br>4. Verify saved | ☐ | |
| Document History | 1. View document history<br>2. Verify all documents listed<br>3. Verify dates correct<br>4. Verify "View" links work | ☐ | |
| Service/Repair Reports | 1. Sign off service/repair<br>2. Attach report<br>3. Verify appears in certs<br>4. Verify "Not provided" if missing | ☐ | |
| Attach Report Later | 1. View asset with missing report<br>2. Click "Attach report"<br>3. Upload document<br>4. Verify appears in certs | ☐ | |
| Back Navigation | 1. Navigate to asset from search<br>2. Click back<br>3. Verify returns to search<br>4. Test from different screens | ☐ | |

---

## 5. Asset Types

| Feature/Input | Test Steps | Working | Feedback/Issues |
|--------------|------------|---------|-----------------|
| Asset Type List | 1. Navigate to Inventory<br>2. Click Asset Types tab<br>3. Verify types listed<br>4. Verify images display | ☐ | |
| Asset Type Detail | 1. Click asset type<br>2. Verify details display<br>3. Verify custom fields listed | ☐ | |
| Create Asset Type | 1. Click "Create New Asset Type"<br>2. Fill form<br>3. Add custom fields<br>4. Submit<br>5. Verify created | ☐ | |
| Edit Asset Type | 1. Click Edit<br>2. Modify fields<br>3. Add/remove custom fields<br>4. Save<br>5. Verify changes | ☐ | |
| Custom Fields | 1. Add custom field<br>2. Set field type<br>3. Set required/optional<br>4. Verify appears in asset forms | ☐ | |
| Asset Type Image | 1. Upload image for type<br>2. Verify displays in list<br>3. Verify displays in asset forms | ☐ | |

---

## 6. Certificates/Documents

| Feature/Input | Test Steps | Working | Feedback/Issues |
|--------------|------------|---------|-----------------|
| Certs List View | 1. Navigate to Certs<br>2. Verify documents listed<br>3. Verify card/table layout | ☐ | |
| Quick Filters - My Documents | 1. Click "My Documents"<br>2. Verify only user's assets shown<br>3. Verify correct matching | ☐ | |
| Quick Filters - Expiring Soon | 1. Click "Expiring Soon"<br>2. Verify filtered results<br>3. Verify dates correct | ☐ | |
| Quick Filters - Expired | 1. Click "Expired"<br>2. Verify expired documents shown | ☐ | |
| Document Filters | 1. Open filters<br>2. Select document type<br>3. Apply<br>4. Verify filtered | ☐ | |
| Open Document | 1. Click "Open" on document<br>2. Verify document opens<br>3. Verify correct document | ☐ | |
| Edit Document | 1. Click "Edit"<br>2. Modify details<br>3. Save<br>4. Verify changes | ☐ | |
| Document Sorting | 1. Change sort option<br>2. Verify documents re-sorted | ☐ | |
| Mobile Certs Layout | 1. Open on mobile<br>2. Verify card layout<br>3. Verify filters accessible<br>4. Verify alignment correct | ☐ | |
| Service/Repair Reports | 1. Verify service reports appear<br>2. Verify repair reports appear<br>3. Verify missing reports show "Not provided" | ☐ | |
| Document Links | 1. Click document link<br>2. Verify opens correctly<br>3. Verify "View" text displays | ☐ | |
| Document Date Matching | 1. Create service/repair with date<br>2. Attach document<br>3. Verify only matching date documents linked | ☐ | |

---

## 7. Activity Log

| Feature/Input | Test Steps | Working | Feedback/Issues |
|--------------|------------|---------|-----------------|
| Activity List | 1. Navigate to Activity<br>2. Verify activities listed<br>3. Verify chronological order | ☐ | |
| Activity Details | 1. View activity entry<br>2. Verify all details shown<br>3. Verify user info<br>4. Verify asset info | ☐ | |
| Activity Filtering | 1. Filter by activity type<br>2. Verify filtered results<br>3. Filter by user<br>4. Verify filtered | ☐ | |
| Activity Navigation | 1. Click asset link<br>2. Verify navigates to asset<br>3. Verify back navigation works | ☐ | |

---

## 8. QR Code Features

| Feature/Input | Test Steps | Working | Feedback/Issues |
|--------------|------------|---------|-----------------|
| QR Scanner | 1. Open QR scanner<br>2. Grant camera permission<br>3. Scan QR code<br>4. Verify asset detected | ☐ | |
| QR Code Display | 1. View asset<br>2. Verify QR code displays<br>3. Verify correct data encoded | ☐ | |
| QR Sheet Generation | 1. Admin: Generate QR sheet<br>2. Verify PDF generated<br>3. Verify QR codes correct<br>4. Verify printing works | ☐ | |
| QR Check-in | 1. Scan QR code<br>2. Verify check-in page opens<br>3. Complete check-in<br>4. Verify activity logged | ☐ | |
| Location Capture | 1. Scan QR with location permission<br>2. Verify location captured<br>3. Verify saved to asset | ☐ | |
| QR Sheet Layout | 1. Generate QR sheet<br>2. Verify labels positioned correctly<br>3. Verify column shifts applied<br>4. Verify vertical offset correct | ☐ | |

---

## 9. Quick Actions & Shortcuts

| Feature/Input | Test Steps | Working | Feedback/Issues |
|--------------|------------|---------|-----------------|
| Quick View | 1. Select Quick View shortcut<br>2. Scan asset<br>3. Verify asset detail opens<br>4. Verify stays open | ☐ | |
| Quick Transfer | 1. Select Quick Transfer<br>2. Scan asset<br>3. Select recipient<br>4. Verify transfer completes<br>5. Verify location captured | ☐ | |
| Quick Transfer Office | 1. Select Quick Transfer Office<br>2. Scan asset<br>3. Verify assigned to admin<br>4. Verify location captured<br>5. Test already assigned message | ☐ | |
| Transfer-To Me | 1. Select Transfer-To Me<br>2. Scan asset<br>3. Verify assigned to user<br>4. Verify location captured<br>5. Test already assigned message | ☐ | |
| Quick Service | 1. Select Quick Service<br>2. Scan asset<br>3. Fill service form<br>4. Submit<br>5. Verify logged<br>6. Verify status updated | ☐ | |
| Quick Repair | 1. Select Quick Repair<br>2. Scan asset<br>3. Fill repair form<br>4. Submit<br>5. Verify logged<br>6. Verify status updated | ☐ | |
| Service Sign-off | 1. Open pending service task<br>2. Fill sign-off form<br>3. Attach report (optional)<br>4. Sign off<br>5. Verify status "In Service"<br>6. Verify activity logged | ☐ | |
| Repair Sign-off | 1. Open pending repair task<br>2. Fill sign-off form<br>3. Attach report (optional)<br>4. Sign off<br>5. Verify status "In Service"<br>6. Verify activity logged | ☐ | |
| Transfer User Selection | 1. Select Quick Transfer<br>2. Scan asset<br>3. Verify user list displays<br>4. Search for user<br>5. Select user<br>6. Verify transfer completes | ☐ | |

---

## 10. Admin Features

| Feature/Input | Test Steps | Working | Feedback/Issues |
|--------------|------------|---------|-----------------|
| Admin Access | 1. Login as admin<br>2. Verify admin features visible<br>3. Verify Generate QR shortcut available | ☐ | |
| Generate QR Sheet | 1. Click Generate QR Sheet<br>2. Enter number of sheets<br>3. Generate<br>4. Verify PDF created<br>5. Verify QR codes correct | ☐ | |
| User Management | 1. Navigate to Admin<br>2. View users list<br>3. Verify user details<br>4. Test user actions | ☐ | |
| Domain Management | 1. Access domain management<br>2. Verify domains listed<br>3. Test domain operations | ☐ | |
| Reset Password | 1. Select user<br>2. Reset password<br>3. Verify reset email sent | ☐ | |

---

## 11. Profile & Settings

| Feature/Input | Test Steps | Working | Feedback/Issues |
|--------------|------------|---------|-----------------|
| Profile View | 1. Navigate to Profile<br>2. Verify user info displays<br>3. Verify email/name shown | ☐ | |
| Edit Profile | 1. Edit profile fields<br>2. Save changes<br>3. Verify updates saved | ☐ | |
| My Assets | 1. Navigate to My Assets<br>2. Verify assigned assets listed<br>3. Verify can access assets | ☐ | |

---

## 12. Mobile-Specific Features

| Feature/Input | Test Steps | Working | Feedback/Issues |
|--------------|------------|---------|-----------------|
| Bottom Tab Navigation | 1. Verify tabs visible<br>2. Switch between tabs<br>3. Verify navigation works | ☐ | |
| Mobile Layout - Search | 1. Open search on mobile<br>2. Verify card layout<br>3. Verify responsive design<br>4. Verify filters accessible | ☐ | |
| Mobile Layout - Certs | 1. Open certs on mobile<br>2. Verify card layout<br>3. Verify alignment<br>4. Verify filters work | ☐ | |
| Screen Header | 1. Verify header displays<br>2. Verify back button works<br>3. Verify title centered<br>4. Verify navigation consistent | ☐ | |
| Touch Interactions | 1. Test all touch targets<br>2. Verify adequate size<br>3. Verify feedback on tap | ☐ | |
| Keyboard Handling | 1. Open forms<br>2. Verify keyboard appears<br>3. Verify input accessible<br>4. Verify keyboard dismisses | ☐ | |
| Camera Permissions | 1. Request camera access<br>2. Verify permission prompt<br>3. Grant/deny<br>4. Verify behavior | ☐ | |
| Location Permissions | 1. Request location access<br>2. Verify permission prompt<br>3. Grant/deny<br>4. Verify behavior | ☐ | |

---

## 13. Web-Specific Features

| Feature/Input | Test Steps | Working | Feedback/Issues |
|--------------|------------|---------|-----------------|
| Web Navbar | 1. Verify navbar displays<br>2. Verify all links work<br>3. Verify active state highlighting<br>4. Verify Certs link highlights | ☐ | |
| Table Layout | 1. Verify table displays correctly<br>2. Verify columns visible<br>3. Verify horizontal scroll works<br>4. Verify borders aligned | ☐ | |
| Grid/Table Toggle | 1. Switch between views<br>2. Verify both work<br>3. Verify state persists | ☐ | |
| Responsive Design | 1. Resize browser window<br>2. Verify layout adapts<br>3. Verify no horizontal scroll<br>4. Verify all features accessible | ☐ | |
| Keyboard Shortcuts | 1. Test keyboard navigation<br>2. Verify shortcuts work<br>3. Verify focus management | ☐ | |

---

## 14. Performance & Error Handling

| Feature/Input | Test Steps | Working | Feedback/Issues |
|--------------|------------|---------|-----------------|
| Loading States | 1. Perform slow operations<br>2. Verify loading indicators<br>3. Verify user feedback | ☐ | |
| Error Messages | 1. Trigger errors<br>2. Verify error messages display<br>3. Verify helpful messages<br>4. Verify recovery options | ☐ | |
| Network Errors | 1. Disconnect network<br>2. Perform actions<br>3. Verify error handling<br>4. Verify retry options | ☐ | |
| Large Data Sets | 1. Load large asset list<br>2. Verify performance<br>3. Verify pagination works<br>4. Verify no crashes | ☐ | |
| Image Loading | 1. Load assets with images<br>2. Verify images load<br>3. Verify placeholders<br>4. Verify error handling | ☐ | |
| Form Validation | 1. Submit invalid forms<br>2. Verify validation messages<br>3. Verify prevents submission<br>4. Verify helpful hints | ☐ | |
| Concurrent Actions | 1. Perform multiple actions<br>2. Verify no conflicts<br>3. Verify state consistency | ☐ | |

---

## Test Summary

**Total Test Cases:** ________

**Passed:** ________

**Failed:** ________

**Blocked:** ________

---

## Overall Feedback

Use this section to provide overall feedback, major issues, and recommendations:

________________________________________________________________

________________________________________________________________

________________________________________________________________

---

**Notes:**
- Use ☐ to mark untested items
- Use ✓ to mark passed tests
- Use ✗ to mark failed tests
- Use ⚠ to mark blocked tests
- Fill in the "Working" and "Feedback/Issues" columns during testing

