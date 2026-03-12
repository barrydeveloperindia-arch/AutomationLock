// Full-featured attendance listing endpoint
// Supports: date range, employee, department, search, pagination, sorting
app.get('/api/attendance', authenticateToken, async (req, res) => {
    try {
        const {
            startDate,
            endDate,
            date,
            employee_id,
            department,
            search,
            page = 1,
            pageSize = 10,
            sortBy = 'date',
            sortDir = 'desc',
        } = req.query;

        // Resolve date range
        const today = new Date().toISOString().split('T')[0];
        const fromDate = startDate || date || today;
        const toDate = endDate || date || today;

        // Allowed sort columns (whitelist to prevent injection)
        const allowedSortCols = ['date', 'check_in', 'check_out', 'working_hours', 'status'];
        const col = allowedSortCols.includes(sortBy) ? sortBy : 'date';
        const asc = sortDir === 'asc';

        // ── Count query (for pagination total) ──
        let countQ = supabase
            .from('attendance')
            .select('id, employees!inner(name, employee_id, department)', { count: 'exact', head: true })
            .gte('date', fromDate)
            .lte('date', toDate);

        if (employee_id) countQ = countQ.eq('employee_id', employee_id);
        if (department) countQ = countQ.eq('employees.department', department);
        if (search) countQ = countQ.ilike('employees.name', `%${search}%`);

        // ── Data query ──
        let dataQ = supabase
            .from('attendance')
            .select('*, employees!inner(name, employee_id, image_url, department)')
            .gte('date', fromDate)
            .lte('date', toDate)
            .order(col, { ascending: asc })
            .range((page - 1) * pageSize, page * pageSize - 1);

        if (employee_id) dataQ = dataQ.eq('employee_id', employee_id);
        if (department) dataQ = dataQ.eq('employees.department', department);
        if (search) dataQ = dataQ.ilike('employees.name', `%${search}%`);

        const [{ count }, { data, error }] = await Promise.all([countQ, dataQ]);

        if (error) throw error;

        res.json({ data: data || [], total: count || 0 });
    } catch (error) {
        console.error('❌ Get attendance error:', error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});
