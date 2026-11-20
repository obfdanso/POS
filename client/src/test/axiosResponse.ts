import { AxiosHeaders, type AxiosResponse } from 'axios'

/** A 200 response carrying `data`, for mocked service calls */
export function axiosResponse<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } }
}
