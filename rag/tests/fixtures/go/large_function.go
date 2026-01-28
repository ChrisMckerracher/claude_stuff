package processor

import "fmt"

// ProcessLargeData handles many different data types with extensive switch cases.
// This function is intentionally large to test chunking of oversized declarations.
func ProcessLargeData(dataType string, value interface{}) (string, error) {
	switch dataType {
	case "string":
		str, ok := value.(string)
		if !ok {
			return "", fmt.Errorf("expected string, got %T", value)
		}
		// Process string data
		result := "processed_string:" + str
		return result, nil
	case "integer":
		num, ok := value.(int)
		if !ok {
			return "", fmt.Errorf("expected int, got %T", value)
		}
		// Process integer data
		result := fmt.Sprintf("processed_int:%d", num*2)
		return result, nil
	case "float":
		fnum, ok := value.(float64)
		if !ok {
			return "", fmt.Errorf("expected float64, got %T", value)
		}
		// Process float data
		result := fmt.Sprintf("processed_float:%.2f", fnum*1.5)
		return result, nil
	case "boolean":
		bval, ok := value.(bool)
		if !ok {
			return "", fmt.Errorf("expected bool, got %T", value)
		}
		// Process boolean data
		result := fmt.Sprintf("processed_bool:%v", !bval)
		return result, nil
	case "array":
		arr, ok := value.([]interface{})
		if !ok {
			return "", fmt.Errorf("expected array, got %T", value)
		}
		// Process array data
		result := fmt.Sprintf("processed_array:len=%d", len(arr))
		return result, nil
	case "map":
		m, ok := value.(map[string]interface{})
		if !ok {
			return "", fmt.Errorf("expected map, got %T", value)
		}
		// Process map data
		result := fmt.Sprintf("processed_map:keys=%d", len(m))
		return result, nil
	case "null":
		if value != nil {
			return "", fmt.Errorf("expected nil, got %T", value)
		}
		// Process null data
		return "processed_null:nil", nil
	case "timestamp":
		ts, ok := value.(string)
		if !ok {
			return "", fmt.Errorf("expected timestamp string, got %T", value)
		}
		// Process timestamp
		result := "processed_timestamp:" + ts
		return result, nil
	case "uuid":
		uuid, ok := value.(string)
		if !ok {
			return "", fmt.Errorf("expected uuid string, got %T", value)
		}
		// Process UUID
		result := "processed_uuid:" + uuid
		return result, nil
	case "email":
		email, ok := value.(string)
		if !ok {
			return "", fmt.Errorf("expected email string, got %T", value)
		}
		// Process email
		result := "processed_email:" + email
		return result, nil
	case "url":
		url, ok := value.(string)
		if !ok {
			return "", fmt.Errorf("expected url string, got %T", value)
		}
		// Process URL
		result := "processed_url:" + url
		return result, nil
	case "json":
		json, ok := value.(string)
		if !ok {
			return "", fmt.Errorf("expected json string, got %T", value)
		}
		// Process JSON
		result := "processed_json:" + json
		return result, nil
	case "binary":
		bin, ok := value.([]byte)
		if !ok {
			return "", fmt.Errorf("expected binary, got %T", value)
		}
		// Process binary data
		result := fmt.Sprintf("processed_binary:len=%d", len(bin))
		return result, nil
	case "coordinates":
		coords, ok := value.([]float64)
		if !ok {
			return "", fmt.Errorf("expected coordinates, got %T", value)
		}
		if len(coords) != 2 {
			return "", fmt.Errorf("expected 2 coordinates, got %d", len(coords))
		}
		// Process coordinates
		result := fmt.Sprintf("processed_coords:lat=%.4f,lng=%.4f", coords[0], coords[1])
		return result, nil
	case "currency":
		amount, ok := value.(float64)
		if !ok {
			return "", fmt.Errorf("expected currency amount, got %T", value)
		}
		// Process currency
		result := fmt.Sprintf("processed_currency:$%.2f", amount)
		return result, nil
	case "percentage":
		pct, ok := value.(float64)
		if !ok {
			return "", fmt.Errorf("expected percentage, got %T", value)
		}
		// Process percentage
		result := fmt.Sprintf("processed_percentage:%.1f%%", pct*100)
		return result, nil
	case "phone":
		phone, ok := value.(string)
		if !ok {
			return "", fmt.Errorf("expected phone string, got %T", value)
		}
		// Process phone number
		result := "processed_phone:" + phone
		return result, nil
	case "address":
		addr, ok := value.(map[string]string)
		if !ok {
			return "", fmt.Errorf("expected address map, got %T", value)
		}
		// Process address
		result := fmt.Sprintf("processed_address:fields=%d", len(addr))
		return result, nil
	case "status":
		status, ok := value.(string)
		if !ok {
			return "", fmt.Errorf("expected status string, got %T", value)
		}
		// Process status
		result := "processed_status:" + status
		return result, nil
	default:
		return "", fmt.Errorf("unsupported data type: %s", dataType)
	}
}

// AnotherFunction is here to ensure the file has multiple declarations.
func AnotherFunction(x int) int {
	return x * 2
}
