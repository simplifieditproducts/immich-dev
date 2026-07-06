# Contacts API

Base path: `/contacts`

All endpoints require authentication. Permissions: `ContactUpload`, `ContactRead`, or `ContactDelete`.

## Upload

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| `PUT` | `/contacts/devices/:deviceId` | `ContactUpload` | Upload a VCF file for the given device. Replaces only that device's contributions; other devices are unaffected. Returns `204`. |
| `PUT` | `/contacts` | `ContactUpload` | **Legacy shim** (excluded from OpenAPI) for pre-multi-device mobile clients. Routes the upload to the synthetic `LEGACY_DEVICE_ID = 'legacy'` so it shares per-device replace semantics. New mobile clients should call `DELETE /contacts/devices/legacy` once after upgrading to clear the synthetic device. Returns `204`. |

Both endpoints stream the raw request body into a `Buffer` before handing it to `ContactService.upload`.

## Devices

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| `GET` | `/contacts/devices` | `ContactRead` | List devices that have uploaded contacts. Returns `ContactDevicesResponseDto`. |
| `DELETE` | `/contacts/devices/:deviceId` | `ContactDelete` | Remove all contacts contributed by one device. Returns `204`. |
| `GET` | `/contacts/devices/:deviceId/vcf` | `ContactRead` | Download a device's contacts as a VCF file. Returns the original raw vCard blocks contributed by this device, concatenated. |

## Read

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| `GET` | `/contacts` | `ContactRead` | List contacts. Returns the full deduplicated list with only the fields needed for the list view (`id`, `displayName`, `organization`, `title`, `avatar`). Heavy fields are loaded on demand by the single-contact endpoint. Returns `ContactsResponseDto`. |
| `GET` | `/contacts/:id` | `ContactRead` | Retrieve a single contact. Returns `ContactDto`. |
| `GET` | `/contacts/vcf` | `ContactRead` | Download all contacts as a VCF file — every stored vCard block for the user, across all devices, including unparsed entries, concatenated. |

## Bulk

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| `POST` | `/contacts/export` | `ContactRead` | Export selected contacts as a VCF file. Body: `ContactBulkRequestDto`. |
| `POST` | `/contacts/delete` | `ContactDelete` | Delete the given contacts. Body: `ContactBulkRequestDto`. Returns `204`. |

## Delete

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| `DELETE` | `/contacts/:id` | `ContactDelete` | Delete a single contact. Returns `204`. |
| `DELETE` | `/contacts` | `ContactDelete` | Delete all contacts for the user. Returns `204`. |

## Notes

- `LEGACY_DEVICE_ID` is the synthetic device id (`'legacy'`) used by legacy mobile clients that hit `PUT /contacts` without a deviceId. New clients pass a real per-install UUID.
- VCF download endpoints return a `StreamableFile`.
- Path param shapes: `DeviceIdParamDto` (non-empty string `deviceId`), `UUIDParamDto` (`id`).
