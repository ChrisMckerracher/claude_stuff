using System;
using System.Collections.Generic;

namespace Api.Models
{
    public class DataProcessor
    {
        private readonly Dictionary<string, object> _cache;

        public DataProcessor()
        {
            _cache = new Dictionary<string, object>();
        }

        public string ProcessString(string input)
        {
            if (string.IsNullOrEmpty(input))
                return string.Empty;
            return input.Trim().ToUpperInvariant();
        }

        public int ProcessNumber(int input)
        {
            return input * 2 + 10;
        }

        public double ProcessDouble(double input)
        {
            return Math.Round(input * 1.5, 2);
        }

        public bool ProcessBoolean(bool input)
        {
            return !input;
        }

        public List<T> ProcessList<T>(List<T> input)
        {
            var result = new List<T>(input);
            result.Reverse();
            return result;
        }

        public Dictionary<string, TValue> ProcessDictionary<TValue>(Dictionary<string, TValue> input)
        {
            var result = new Dictionary<string, TValue>();
            foreach (var kvp in input)
            {
                result[kvp.Key.ToLowerInvariant()] = kvp.Value;
            }
            return result;
        }

        public void CacheValue(string key, object value)
        {
            _cache[key] = value;
        }

        public object GetCachedValue(string key)
        {
            return _cache.TryGetValue(key, out var value) ? value : null;
        }

        public void ClearCache()
        {
            _cache.Clear();
        }
    }
}
