/** Query params for admin listing endpoints */
export interface AdminListQuery {
  page?: string;
  limit?: string;
  roleId?: string;
  roleName?: string;
  status?: string;
  parentId?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  walletType?: string;
}
